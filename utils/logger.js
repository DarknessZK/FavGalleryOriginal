// ==========================================
// FavGallery - 日志工具
// 功能：控制台日志管理（Logger 类 + createLogger 工厂函数）
// ==========================================

/**
 * Logger 类 - 控制台日志
 * 职责：提供模块化的控制台日志输出
 */
class Logger {
    constructor(module) {
        this.module = module;
    }

    /**
     * 信息日志
     */
    info(...args) {
        console.log(`[${this.module}]`, ...args);
    }

    /**
     * 调试日志
     */
    debug(...args) {
        console.debug(`[${this.module}]`, ...args);
    }

    /**
     * 警告日志
     */
    warn(...args) {
        console.warn(`[${this.module}]`, ...args);
    }

    /**
     * 错误日志
     */
    error(...args) {
        console.error(`[${this.module}]`, ...args);
    }
}

/**
 * Logger 工厂函数
 * 创建指定模块的 Logger 实例
 *
 * @param {string} module - 模块名称
 * @returns {Logger} Logger 实例
 *
 * @example
 * const logger = createLogger('DouyinAPI');
 * logger.info('初始化完成');
 */
export function createLogger(module) {
    return new Logger(module);
}

/**
 * 将日志消息显示到 UI 的操作日志框
 * @param {string} level - 日志级别 ('info' | 'warn' | 'error')
 * @param {string} message - 日志消息
 */
export function logToUI(level, message) {
    try {
        const logElement = document.getElementById('logArea');
        
        if (!logElement) {
            console.warn('[logToUI] ⚠️ 未找到 logArea 元素');
            return;
        }
        
        const timestamp = new Date().toLocaleTimeString('zh-CN');
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${level}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        logElement.appendChild(logEntry);
        logElement.scrollTop = logElement.scrollHeight;
        
        const maxLogs = 100;
        while (logElement.children.length > maxLogs) {
            logElement.removeChild(logElement.firstChild);
        }
        
    } catch (error) {
        console.error('[logToUI] ❌ 显示日志失败:', error);
    }
}

// 便捷导出
export { Logger };
export default createLogger;
