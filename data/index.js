// ==========================================
// FavGallery - 数据层统一导出
// 职责：提供统一的数据访问接口
// ==========================================

export { database } from './database.js';
export { fileSystem } from './file-system.js';
export * as relationManager from './relation-manager.js';

// 也导出类本身（供需要创建新实例的场景）
export { Database } from './database.js';
export { FileSystem } from './file-system.js';

// 关系管理器默认导出
export { default as relationManagerDefault } from './relation-manager.js';
