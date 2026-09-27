// ==========================================
// FavGallery - 错误边界
// 职责：捕获全局未处理错误（error / unhandledrejection），同文案去重后上报给接入方
// 约束：只"旁观"不拦截——不 preventDefault，不影响既有 try-catch 与控制台原生输出
// ==========================================

import { createLogger } from './logger.js';

const logger = createLogger('ErrorBoundary');

// 同文案去重窗口（毫秒）
const DEDUP_WINDOW_MS = 5000;
// 去重表容量上限（防长时间运行累积）
const DEDUP_MAX_ENTRIES = 50;

// 最近一次安装的边界（供 reportError 手动上报）
let activeBoundary = null;

/**
 * 安装全局错误边界
 * @param {Object} options
 * @param {string} [options.context] - 上下文标识（'Sidebar' | 'Content'，仅日志用）
 * @param {Function} [options.onError] - 错误回调 ({ message, count, error, source }) => void
 * @returns {{ reportError: Function }} 边界句柄（含手动上报入口）
 */
function installErrorBoundary({ context = '', onError } = {}) {
    /** 去重表：key = 错误文案前缀，value = { message, count, ts } */
    const recent = new Map();

    const report = (error, source) => {
        let message;
        if (error && typeof error === 'object' && (error.stack || error.message)) {
            message = error.stack || error.message;
        } else {
            message = String(error ?? `${source || 'unknown'}: 未知错误`);
        }
        const key = message.slice(0, 200);
        const now = Date.now();
        const last = recent.get(key);

        if (last && now - last.ts < DEDUP_WINDOW_MS) {
            // 窗口内同文案：合并计数，不刷新 ts（窗口从首次出现起算）
            last.count += 1;
            if (onError) onError(last);
            return last;
        }

        const entry = { message: key, count: 1, ts: now, error, source };
        recent.set(key, entry);
        if (recent.size > DEDUP_MAX_ENTRIES) {
            recent.delete(recent.keys().next().value); // 先进先出
        }
        if (onError) onError(entry);
        return entry;
    };

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('error', (event) => {
            report(event.error || event.message, 'window.onerror');
            // 不调 preventDefault：保留浏览器默认控制台输出
        });

        window.addEventListener('unhandledrejection', (event) => {
            report(event.reason, 'unhandledrejection');
        });
    }

    activeBoundary = { reportError: report, context };
    logger.info(`✅ 错误边界已安装${context ? `（${context}）` : ''}`);
    return activeBoundary;
}

/**
 * 手动上报错误（走最近安装的边界的去重与回调）
 * @param {*} err - Error 或任意错误值
 * @param {string} [source] - 来源标识
 */
function reportError(err, source) {
    if (activeBoundary) {
        activeBoundary.reportError(err, source);
    } else {
        logger.warn('⚠️ 边界未安装，直接输出:', source, err);
    }
}

export { installErrorBoundary, reportError };
