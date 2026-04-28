// ==========================================
// FavGallery - 下载锁管理器
// 职责：防止并发下载，确保同一时间只有一个下载任务在运行
// ==========================================

import { createLogger } from '../utils/logger.js';

const logger = createLogger('DownloadLock');

export class DownloadLock {
    constructor() {
        // 当前正在执行的任务
        this.currentTask = null;

        // 任务队列（可选：未来可以支持排队）
        this.taskQueue = [];
    }

    /**
     * 检查是否可以开始新任务
     * @param {Object} newTask - 新任务信息
     * @param {string} newTask.type - 任务类型（'batch' | 'author' | 'collects' | 'group'）
     * @param {string} newTask.id - 任务ID
     * @returns {boolean} 是否可以开始
     */
    canStart(newTask) {
        if (!this.currentTask) {
            return true;  // 没有任务在运行，可以开始
        }

        logger.warn(`⚠️ 已有任务在运行: ${this.currentTask.type} (${this.currentTask.id})`);
        logger.warn(`   拒绝新任务: ${newTask.type} (${newTask.id})`);

        return false;
    }

    /**
     * 开始任务（加锁）
     * @param {Object} task - 任务信息
     * @param {string} task.type - 任务类型
     * @param {string} task.id - 任务ID
     * @param {string} task.description - 任务描述（用于日志）
     * @returns {boolean} 是否成功加锁
     */
    start(task) {
        if (!this.canStart(task)) {
            return false;
        }

        this.currentTask = {
            ...task,
            startTime: Date.now()
        };

        logger.info(`🔒 锁定下载任务: ${task.type} - ${task.description || task.id}`);
        return true;
    }

    /**
     * 结束任务（释放锁）
     */
    finish() {
        if (!this.currentTask) {
            logger.warn('⚠️ 没有正在运行的任务，无法释放锁');
            return;
        }

        const duration = Date.now() - this.currentTask.startTime;
        logger.info(`🔓 释放下载锁: ${this.currentTask.type} (耗时: ${(duration / 1000).toFixed(1)}秒)`);

        this.currentTask = null;
    }

    /**
     * 获取当前任务信息
     * @returns {Object|null} 当前任务信息，如果没有任务则返回 null
     */
    getCurrentTask() {
        return this.currentTask;
    }

    /**
     * 检查是否有任务在运行
     * @returns {boolean} 是否有任务在运行
     */
    isLocked() {
        return this.currentTask !== null;
    }

    /**
     * 强制释放锁（用于异常情况）
     */
    forceRelease() {
        if (this.currentTask) {
            logger.warn(`⚠️ 强制释放锁: ${this.currentTask.type}`);
            this.currentTask = null;
        }
    }

    /**
     * 获取锁状态信息
     * @returns {Object} 锁状态
     */
    getStatus() {
        if (!this.currentTask) {
            return {
                locked: false,
                currentTask: null
            };
        }

        return {
            locked: true,
            currentTask: {
                type: this.currentTask.type,
                id: this.currentTask.id,
                description: this.currentTask.description,
                startTime: this.currentTask.startTime,
                duration: Date.now() - this.currentTask.startTime
            }
        };
    }
}

// 导出单例
export const downloadLock = new DownloadLock();
export default downloadLock;
