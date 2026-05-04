// ==========================================
// FavGallery - 数据层统一导出
// 职责：提供统一的数据访问接口
// ==========================================

// Database 模块
export { database } from './database/database.js';
export { databaseProxy } from './database/database-proxy.js';
export * as relationManager from './database/relation-manager.js';
export { Database } from './database/database.js';

// Storage 模块
export { fileSystem } from './storage/file-system.js';
export { FileSystem } from './storage/file-system.js';
export * as authorsManager from './storage/authors-manager.js';
export * as worksManager from './storage/works-manager.js';
export * as collectsManager from './storage/collects-manager.js';

// Backup 模块
export { backupManager } from './backup/backup-manager.js';
export { restoreManager } from './backup/restore-manager.js';
