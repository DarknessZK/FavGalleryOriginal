// ==========================================
// FavGallery - 文件系统管理器
// 职责：管理用户本地数据备份（IndexedDB 主存储 + 文件系统异步备份）
// 说明：仅用于用户个人数据的本地备份和整理
// ==========================================

import { CONFIG } from '../config/constants.js';
import { database } from './database.js';
import { createLogger } from '../utils/logger.js';
import { initFileLogger } from '../utils/file-logger.js';
import * as relationManager from './relation-manager.js';
import { sanitizeForFileSystem } from '../utils/helpers.js';

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
            import('./backup-manager.js').then(({ backupManager }) => {
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
    // 作者数据管理
    // ==========================================

    /**
     * 保存作者基本信息到 IndexedDB + 异步备份到文件系统
     *
     * @param {Object} authorsData - 作者数据 { authors: [], metadata: {} }
     */
    async saveAuthorsBase(authorsData) {
        await this.initDatabase();

        // 保存到 IndexedDB（主存储）
        const items = authorsData.authors.map((author, index) => ({
            uid: author.uid,
            order: index,
            ...author
        }));

        await database.save('authors', items);
        logger.info(`💾 已保存 ${items.length} 个作者到 IndexedDB`);

        // 异步备份到文件系统
        this._backupToFileSystem('authors_base', authorsData).catch(error => {
            logger.warn('⚠️ 文件系统备份失败:', error.message);
        });
    }

    /**
     * 加载作者基本信息（IndexedDB 优先，降级到文件系统）
     *
     * @returns {Promise<Object>} { authors: [], metadata: {} }
     */
    async loadAuthorsBase() {
        try {
            await this.initDatabase();

            // 1. 尝试从 IndexedDB 加载
            let items;
            try {
                items = await database.getAll('authors');
            } catch (dbError) {
                if (dbError.name === 'InvalidStateError') {
                    logger.warn('⚠️ IndexedDB 连接已关闭，降级到文件系统');
                    items = null;
                } else {
                    throw dbError;
                }
            }

            let authors = [];
            if (items && items.length > 0) {
                items.sort((a, b) => (a.order || 0) - (b.order || 0));
                authors = items.map(({ order, ...author }) => author);
                logger.info(`✅ 从 IndexedDB 加载 ${authors.length} 个作者`);
            } else {
                // 2. 降级到文件系统
                logger.info('ℹ️ IndexedDB 无数据，尝试从文件系统加载...');
                const content = await this.readTextFile(`${this.getMetadataDir()}/authors_base.js`);

                if (content) {
                    const data = this.deserializeData(content, 'authors_base');
                    authors = data?.authors || [];
                    logger.info(`✅ 从文件系统加载 ${authors.length} 个作者`);
                }
            }

            // 3. 始终从文件系统加载 metadata
            let metadata = {};
            try {
                const content = await this.readTextFile(`${this.getMetadataDir()}/authors_base.js`);
                if (content) {
                    const data = this.deserializeData(content, 'authors_base');
                    metadata = data?.metadata || {};
                }
            } catch (error) {
                logger.warn('⚠️ 加载 metadata 失败:', error.message);
            }

            return { authors, metadata };
        } catch (error) {
            logger.error('❌ 加载作者数据失败:', error);
            return { authors: [], metadata: {} };
        }
    }

    // ==========================================
    // 点赞作品管理
    // ==========================================

    /**
     * 保存点赞作品列表（新架构）
     *
     * @param {Object} data - 作品数据 { works: [], metadata: {} }
     */
    async saveLikedWorks(data) {  // ✅ 改为 saveLikedWorks
        await this.initDatabase();

        const works = data.works || data;  // ✅ 改为 works
        
        // 1. 保存作品元数据到 works store
        const worksToSave = works.map((work, index) => ({  // ✅ 改为 work
            workId: work.workId,
            ...work
        }));
        await database.save('works', worksToSave);
        
        // 2. 建立作品-点赞关系
        try {
            const relations = works.map(work => ({  // ✅ 改为 work
                sourceType: 'work',
                sourceId: work.workId,
                targetType: 'liked',
                targetId: 'liked'
            }));
            await relationManager.batchAddRelations(relations);
        } catch (err) {
            logger.warn('⚠️ 建立关系失败:', err.message);
        }
        
        // 3. 保存点赞分组元数据
        await database.save('liked_group', {
            groupId: 'liked',
            groupName: '点赞',
            workCount: works.length,  // ✅ 改为 works.length
            lastUpdate: Date.now()
        });
        
        logger.info(`💾 已保存 ${works.length} 个点赞作品到 IndexedDB`);

        // 注意：备份由 backup-manager.js 统一处理，不在这里异步备份
    }

    /**
     * 加载点赞作品列表（新架构）
     *
     * @returns {Promise<Object>} { works: [], metadata: {} }
     */
    async loadLikedWorks() {  // ✅ 改为 loadLikedWorks
        try {
            await this.initDatabase();

            // 1. 从关系表获取所有点赞作品ID
            const relations = await relationManager.getIncomingRelations('liked', 'liked');
            const workIds = relations.map(r => r.sourceId);
            
            if (workIds.length > 0) {
                // 2. 批量获取作品详情
                const works = await database.getByIds('works', workIds);  // ✅ 改为 works
                
                logger.info(`✅ 从 IndexedDB 加载 ${works.length} 个点赞作品`);
                
                // 3. 加载元数据
                const likedGroup = await database.get('liked_group', 'liked');
                const metadata = likedGroup || {};
                
                return { works, metadata };  // ✅ 改为 works
            }

            // 4. 降级到文件系统
            logger.info('ℹ️ IndexedDB 无数据，尝试从文件系统加载...');
            const content = await this.readTextFile(`${this.getMetadataDir()}/liked_works.js`);  // ✅ 改为 liked_works

            if (content) {
                const data = this.deserializeData(content, 'liked_works');  // ✅ 改为 liked_works
                const works = data?.works || [];  // ✅ 改为 works
                logger.info(`✅ 从文件系统加载 ${works.length} 个点赞作品`);
                
                // ✅ 自动恢复到 IndexedDB
                if (works.length > 0) {
                    logger.info('🔄 正在从备份文件恢复数据到 IndexedDB...');
                    try {
                        await this.saveLikedWorks({
                            works: works,
                            metadata: data?.metadata || {}
                        });
                        logger.info('✅ 数据已恢复到 IndexedDB');
                    } catch (restoreError) {
                        logger.warn('⚠️ 恢复到 IndexedDB 失败，但不影响使用:', restoreError.message);
                    }
                }
                
                return { works, metadata: data?.metadata || {} };  // ✅ 改为 works
            }

            return { works: [], metadata: {} };  // ✅ 改为 works
        } catch (error) {
            logger.error('❌ 加载点赞作品失败:', error);
            logger.error('   错误类型:', typeof error);
            logger.error('   错误消息:', error?.message || '无消息');
            logger.error('   错误堆栈:', error?.stack || '无堆栈');
            return { works: [], metadata: {} };  // ✅ 改为 works
        }
    }

    // ==========================================
    // 收藏作品管理
    // ==========================================

    /**
     * 保存收藏作品列表（新架构）
     *
     * @param {Object} data - 作品数据 { works: [], collectId: string }
     */
    async saveBookmarkedWorks(data) {  // ✅ 改为 saveBookmarkedWorks
        await this.initDatabase();

        const works = data.works || data;  // ✅ 改为 works
        const collectId = data.collectId || data.collects_id;
        
        if (!collectId) {
            throw new Error('缺少 collectId 参数');
        }
        
        // 1. 保存作品元数据到 works store
        const worksToSave = works.map((work, index) => ({  // ✅ 改为 work
            workId: work.workId,
            ...work
        }));
        await database.save('works', worksToSave);
        
        // 2. 建立作品-收藏夹关系
        try {
            const relations = works.map(work => ({  // ✅ 改为 work
                sourceType: 'work',
                sourceId: work.workId,
                targetType: 'collect',
                targetId: collectId
            }));
            await relationManager.batchAddRelations(relations);
        } catch (err) {
            logger.warn('⚠️ 建立关系失败:', err.message);
        }
        
        // 3. 更新收藏夹元数据
        await database.save('collects', {
            collectId: collectId,
            workCount: works.length,  // ✅ 改为 works.length
            lastUpdate: Date.now()
        });
        
        logger.info(`💾 已保存 ${works.length} 个收藏作品到 IndexedDB (收藏夹: ${collectId})`);

        // 注意：备份由 backup-manager.js 统一处理，不在这里异步备份
    }

    /**
     * 加载指定收藏夹的作品列表（新架构）
     *
     * @param {string} collectId - 收藏夹ID
     * @returns {Promise<Object>} { works: [], metadata: {} }
     */
    async loadBookmarkedWorks(collectId) {  // ✅ 改为 loadBookmarkedWorks
        try {
            await this.initDatabase();

            // 1. 从关系表获取收藏夹的所有作品ID
            const workIds = await relationManager.getCollectWorkIds(collectId);
            
            if (workIds.length > 0) {
                // 2. 批量获取作品详情
                const works = await database.getByIds('works', workIds);  // ✅ 改为 works
                
                // 3. 按创建时间排序
                works.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));  // ✅ 改为 works
                
                logger.info(`✅ 从 IndexedDB 加载收藏夹 ${collectId} 的 ${works.length} 个作品`);
                
                // 4. 加载元数据
                const collectInfo = await database.get('collects', collectId);
                const metadata = collectInfo || {};
                
                return { works, metadata, collectId };  // ✅ 改为 works
            }

            // 5. 降级到文件系统
            logger.info(`ℹ️ IndexedDB 无数据，尝试从文件系统加载收藏夹 ${collectId}...`);
            const content = await this.readTextFile(`${this.getMetadataDir()}/bookmarked_works_${collectId}.js`);  // ✅ 改为 bookmarked_works

            if (content) {
                const data = this.deserializeData(content, `bookmarked_works_${collectId}`);  // ✅ 改为 bookmarked_works
                const works = data?.works || [];  // ✅ 改为 works
                logger.info(`✅ 从文件系统加载收藏夹 ${collectId} 的 ${works.length} 个作品`);
                
                // ✅ 自动恢复到 IndexedDB
                if (works.length > 0) {
                    logger.info(`🔄 正在从备份文件恢复收藏夹 ${collectId} 数据到 IndexedDB...`);
                    try {
                        await this.saveBookmarkedWorks({
                            works: works,
                            collectId: collectId,
                            metadata: data?.metadata || {}
                        });
                        logger.info(`✅ 收藏夹 ${collectId} 数据已恢复到 IndexedDB`);
                    } catch (restoreError) {
                        logger.warn(`⚠️ 恢复收藏夹 ${collectId} 到 IndexedDB 失败，但不影响使用:`, restoreError.message);
                    }
                }
                
                return { works, metadata: data?.metadata || {}, collectId };  // ✅ 改为 works
            }

            return { works: [], metadata: {}, collectId };  // ✅ 改为 works
        } catch (error) {
            logger.error(`❌ 加载收藏夹 ${collectId} 失败:`, error);
            return { works: [], metadata: {}, collectId };  // ✅ 改为 works
        }
    }

    // ==========================================
    // 收藏夹元数据管理
    // ==========================================

    /**
     * 保存收藏夹列表元数据
     *
     * @param {Array} collectsList - 收藏夹列表
     */
    async saveCollectsList(collectsList) {
        await this.initDatabase();
        
        const items = collectsList.map(collect => ({
            collectId: collect.collectId || collect.collects_id,  // ✅ 改为 collectId，兼容旧字段
            collectName: collect.collectName || collect.collects_name,  // ✅ 改为 collectName
            workCount: collect.workCount || collect.video_count || 0,  // ✅ 改为 workCount
            ...collect
        }));
        
        await database.save('collects', items);
        logger.info(`💾 已保存 ${items.length} 个收藏夹元数据`);
    }

    /**
     * 加载所有收藏夹元数据
     *
     * @returns {Promise<Array>} 收藏夹列表
     */
    async loadAllCollects() {
        await this.initDatabase();
        
        const collects = await database.getAll('collects');
        logger.info(`✅ 加载 ${collects?.length || 0} 个收藏夹元数据`);
        return collects || [];
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
        import('./backup-manager.js').then(({ backupManager }) => {
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
