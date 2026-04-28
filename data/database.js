// ==========================================
// FavGallery - IndexedDB 数据库管理器
// 职责：提供统一的数据持久化接口
// ==========================================

import { CONFIG } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Database');

/**
 * 数据库管理类
 * 封装 IndexedDB 操作，提供简洁的 API
 */
export class Database {
    constructor() {
        this.dbName = CONFIG.DB_CONFIG.name;
        this.dbVersion = CONFIG.DB_CONFIG.version;
        this.db = null;
    }

    /**
     * 初始化数据库
     * 创建所有需要的对象存储（object stores）
     *
     * @returns {Promise<IDBDatabase>} 数据库实例
     */
    async init() {
        if (this.db) {
            logger.debug('数据库已初始化，跳过');
            return this.db;
        }

        // ✅ 添加上下文标识，方便调试
        const contextInfo = window.location ? window.location.href : 'unknown';
        logger.info(`📦 开始初始化数据库 (${contextInfo})`);

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                logger.error('❌ IndexedDB 打开失败:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                logger.info('✅ IndexedDB 初始化成功');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = CONFIG.DB_CONFIG.stores;
                const indexes = CONFIG.DB_CONFIG.indexes || {};

                // 动态创建所有配置的存储
                Object.entries(stores).forEach(([storeName, keyPath]) => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, { keyPath });
                        logger.info(`📦 创建存储: ${storeName} (主键: ${keyPath})`);

                        // 创建该 store 的索引
                        if (indexes[storeName]) {
                            indexes[storeName].forEach(index => {
                                try {
                                    store.createIndex(index.name, index.keyPath, { 
                                        unique: index.unique || false 
                                    });
                                    logger.info(`   └─ 创建索引: ${index.name} (${JSON.stringify(index.keyPath)})`);
                                } catch (err) {
                                    logger.warn(`   ⚠️ 索引创建失败: ${index.name}`, err.message);
                                }
                            });
                        }
                    }
                });
            };
        });
    }

    /**
     * 保存数据到指定存储
     *
     * @param {string} storeName - 存储名称
     * @param {Object|Array} data - 要保存的数据（单个对象或数组）
     * @returns {Promise<void>}
     */
    async save(storeName, data) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            // 支持批量保存
            if (Array.isArray(data)) {
                logger.info(`💾 准备保存 ${data.length} 条记录到 ${storeName}`);
                data.forEach(item => {
                    logger.debug(`   └─ 保存: ${item.workId || item.id || 'unknown'}`);
                    store.put(item);
                });
            } else {
                logger.info(`💾 准备保存 1 条记录到 ${storeName}: ${data.workId || data.id || 'unknown'}`);
                store.put(data);
            }

            transaction.oncomplete = () => {
                const count = Array.isArray(data) ? data.length : 1;
                logger.info(`✅ 保存成功: ${storeName} (${count} 条)`);
                resolve();
            };

            transaction.onerror = () => {
                logger.error(`❌ 保存失败: ${storeName}`, transaction.error);
                reject(transaction.error);
            };
        });
    }

    /**
     * 获取单条记录
     *
     * @param {string} storeName - 存储名称
     * @param {*} key - 键值
     * @returns {Promise<Object|null>} 查询结果
     */
    async get(storeName, key) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.get(key);

            request.onsuccess = () => {
                logger.debug(`✅ 获取成功: ${storeName} - ${key}`);
                resolve(request.result);
            };

            request.onerror = () => {
                logger.error(`❌ 获取失败: ${storeName}`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取所有记录
     *
     * @param {string} storeName - 存储名称
     * @returns {Promise<Array>} 所有记录
     */
    async getAll(storeName) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.getAll();

            request.onsuccess = () => {
                const result = request.result;
                logger.info(`✅ 获取全部成功: ${storeName} (${result.length} 条)`);
                if (result.length > 0) {
                    logger.debug(`📋 数据示例:`, result.slice(0, 2));
                }
                resolve(result);
            };

            request.onerror = () => {
                logger.error(`❌ 获取全部失败: ${storeName}`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 批量获取多条记录（通过主键）
     *
     * @param {string} storeName - 存储名称
     * @param {Array} keys - 主键数组
     * @returns {Promise<Array>} 查询结果
     */
    async getByIds(storeName, keys) {
        await this._ensureInitialized();

        if (!keys || keys.length === 0) {
            return [];
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            const results = [];
            let completed = 0;

            keys.forEach(key => {
                const request = store.get(key);
                
                request.onsuccess = () => {
                    if (request.result) {
                        results.push(request.result);
                    }
                    completed++;
                    
                    if (completed === keys.length) {
                        logger.debug(`✅ 批量获取成功: ${storeName} (${results.length}/${keys.length} 条)`);
                        resolve(results);
                    }
                };
                
                request.onerror = () => {
                    logger.error(`❌ 批量获取失败: ${storeName} - ${key}`, request.error);
                    completed++;
                    
                    if (completed === keys.length) {
                        resolve(results);
                    }
                };
            });
        });
    }

    /**
     * 通过索引查询记录
     *
     * @param {string} storeName - 存储名称
     * @param {string} indexName - 索引名称
     * @param {*} key - 索引键值（可以是单个值或数组）
     * @returns {Promise<Array>} 查询结果
     */
    async getByIndex(storeName, indexName, key) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            // 检查索引是否存在
            if (!store.indexNames.contains(indexName)) {
                logger.warn(`⚠️ 索引不存在: ${storeName}.${indexName}`);
                resolve([]);
                return;
            }

            const index = store.index(indexName);
            const request = index.getAll(key);

            request.onsuccess = () => {
                const result = request.result;
                logger.debug(`✅ 索引查询成功: ${storeName}.${indexName} = ${JSON.stringify(key)} (${result.length} 条)`);
                resolve(result);
            };

            request.onerror = () => {
                logger.error(`❌ 索引查询失败: ${storeName}.${indexName}`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 删除指定键的数据
     *
     * @param {string} storeName - 存储名称
     * @param {*} key - 要删除的键值
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const request = store.delete(key);

            transaction.oncomplete = () => {
                logger.debug(`🗑️ 删除成功: ${storeName} - ${key}`);
                resolve();
            };

            transaction.onerror = () => {
                logger.error(`❌ 删除失败: ${storeName}`, transaction.error);
                reject(transaction.error);
            };
        });
    }

    /**
     * 清空指定存储的所有数据
     *
     * @param {string} storeName - 存储名称
     * @returns {Promise<void>}
     */
    async clear(storeName) {
        await this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const request = store.clear();

            transaction.oncomplete = () => {
                logger.debug(`🗑️ 清空成功: ${storeName}`);
                resolve();
            };

            transaction.onerror = () => {
                logger.error(`❌ 清空失败: ${storeName}`, transaction.error);
                reject(transaction.error);
            };
        });
    }

    /**
     * 标记作品为已下载
     * @param {Object|Array} workInfo - 作品信息（单个对象或数组）
     * @param {string} workInfo.workId - 作品 ID
     * @param {number} workInfo.downloadTime - 下载时间
     * @param {string} workInfo.filePath - 文件相对路径
     * @param {number} workInfo.fileSize - 文件大小（字节）
     * @param {string} workInfo.mediaType - 媒体类型（'video' | 'image_post'）
     * @param {string} workInfo.quality - 画质等级（可选）
     */
    async markAsDownloaded(workInfo) {
        await this.save('completed_works', workInfo);
    }

    /**
     * 获取已下载的作品 ID 列表
     * @returns {Promise<Array<string>>} 作品 ID 列表
     */
    async getDownloadedWorkIds() {
        const records = await this.getAll('completed_works');
        return records.map(record => record.workId);
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('🔒 数据库连接已关闭');
        }
    }

    /**
     * 确保数据库已初始化
     * @private
     */
    async _ensureInitialized() {
        // ✅ 检查数据库是否存在且未关闭
        if (!this.db || this.db.closed) {
            logger.info('📦 数据库未初始化或已关闭，重新初始化...');
            await this.init();
        }
    }
}

// 导出单例
export const database = new Database();
export default database;
