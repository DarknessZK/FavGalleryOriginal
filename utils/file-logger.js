// ==========================================
// FavGallery - 文件日志管理器
// 职责：将日志异步批量写入文件（按平台分类）
// ==========================================

import { CONFIG } from '../config/constants.js';

/**
 * 文件日志管理器
 * 负责将日志异步批量写入文件
 */
class FileLogger {
    constructor() {
        this.fileManager = null;
        this.logDirHandle = null;
        this.maxLogFiles = 10;
        
        // 日志队列和定时器
        this.logQueue = [];
        this.flushTimer = null;
        this.FLUSH_INTERVAL = 2000; // 每 2 秒刷新一次
        this.isFlushing = false;
        this.initialized = false;
    }

    /**
     * 初始化日志系统
     * @param {Object} fileManager - 文件系统管理器实例
     */
    async init(fileManager) {
        if (this.initialized) {
            return;
        }

        this.fileManager = fileManager;
        await this.ensureLogDirectory();
        
        // 启动定时刷新
        this.startPeriodicFlush();
        
        this.initialized = true;
        console.log('[FileLogger] ✅ 日志系统已初始化');
    }

    /**
     * 启动定时刷新
     */
    startPeriodicFlush() {
        if (this.flushTimer) return;
        
        this.flushTimer = setInterval(() => {
            this.flushLogs();
        }, this.FLUSH_INTERVAL);
    }

    /**
     * 停止定时刷新
     */
    stopPeriodicFlush() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
            // 刷新剩余日志
            this.flushLogs();
        }
    }

    /**
     * 刷新日志队列到文件
     */
    async flushLogs() {
        if (this.isFlushing || this.logQueue.length === 0) {
            return;
        }

        this.isFlushing = true;
        
        try {
            const logsToWrite = [...this.logQueue];
            this.logQueue = [];

            const fileName = this.getTodayLogFileName();
            
            // ✅ 使用配置中的日志路径，按平台分类
            const platform = CONFIG.ACTIVE_PLATFORM;
            const logPath = `${CONFIG.FILE_SYSTEM.LOG_DIR}/${platform}`;
            const pathParts = logPath.split('/');
            
            let currentDir = this.fileManager.rootDirectoryHandle;
            for (const part of pathParts) {
                currentDir = await currentDir.getDirectoryHandle(part, { create: true });
            }
            
            const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable({ keepExistingData: true });

            const file = await fileHandle.getFile();
            await writable.seek(file.size);

            await writable.write(logsToWrite.join('\n') + '\n');
            await writable.close();

            await this.cleanupOldLogs(currentDir);
        } catch (error) {
            console.error('[FileLogger] ❌ 刷新日志失败:', error.message || error);
            // 失败的日志放回队列头部
            this.logQueue.unshift(...logsToWrite);
        } finally {
            this.isFlushing = false;
        }
    }

    /**
     * 确保 logs 目录存在
     */
    async ensureLogDirectory() {
        try {
            if (!this.fileManager || !this.fileManager.rootDirectoryHandle) {
                console.warn('[FileLogger] ⚠️ FileManager 未初始化，跳过日志目录创建');
                return;
            }

            try {
                // ✅ 使用配置中的日志路径
                const logPath = CONFIG.FILE_SYSTEM.LOG_DIR;
                const pathParts = logPath.split('/');
                
                let currentDir = this.fileManager.rootDirectoryHandle;
                
                // 逐级创建目录
                for (const part of pathParts) {
                    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
                }
                
                this.logDirHandle = currentDir;
                console.log('[FileLogger] ✅ 日志目录已就绪:', logPath);
            } catch (error) {
                console.error('[FileLogger] ❌ 创建日志目录失败:', error);
            }
        } catch (error) {
            console.error('[FileLogger] ❌ 初始化日志系统失败:', error);
        }
    }

    /**
     * 获取今天的日志文件名
     */
    getTodayLogFileName() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}.log`;
    }

    /**
     * 格式化日志消息
     */
    formatMessage(level, module, message) {
        const date = new Date().toISOString();
        return `[${date}] [${level}] [${module}] ${message}`;
    }

    /**
     * 写入日志到队列（异步批量写入）
     */
    async writeToFile(level, module, message) {
        try {
            if (!this.initialized || !this.fileManager || !this.fileManager.rootDirectoryHandle) {
                return;
            }

            const formattedMessage = this.formatMessage(level, module, message);
            
            // 加入队列，由定时器批量写入
            this.logQueue.push(formattedMessage);
            
            // 如果队列太长，立即刷新
            if (this.logQueue.length > 50) {
                await this.flushLogs();
            }
        } catch (error) {
            console.error('[FileLogger] ❌ 加入日志队列失败:', error.message || error);
        }
    }

    /**
     * 清理旧日志（保留最近 10 个文件）
     */
    async cleanupOldLogs(logDirHandle) {
        try {
            if (!logDirHandle) return;

            const logFiles = [];
            for await (const entry of logDirHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.log')) {
                    logFiles.push(entry);
                }
            }

            logFiles.sort((a, b) => a.name.localeCompare(b.name));

            while (logFiles.length > this.maxLogFiles) {
                const oldestFile = logFiles.shift();
                await logDirHandle.removeEntry(oldestFile.name);
                console.log('[FileLogger] 🗑️ 删除旧日志:', oldestFile.name);
            }
        } catch (error) {
            console.error('[FileLogger] ❌ 清理旧日志失败:', error);
        }
    }
}

// 创建单例
const fileLogger = new FileLogger();

/**
 * 初始化文件日志系统
 * @param {Object} fileManager - 文件系统管理器实例
 */
export async function initFileLogger(fileManager) {
    await fileLogger.init(fileManager);
}

export default fileLogger;
