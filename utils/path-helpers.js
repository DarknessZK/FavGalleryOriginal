// ==========================================
// 路径辅助工具函数
// 功能：提供下载目录路径生成等路径相关工具
// ==========================================

import { CONFIG } from '../config/constants.js';

/**
 * 根据模板生成文件夹/文件名称
 * @param {string} template - 模板字符串（如 '{nickname}({uid})'）
 * @param {Object} data - 数据对象
 * @returns {string} 生成的名称
 */
function generateNameFromTemplate(template, data) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : '';
    });
}

/**
 * 清理名称中的非法字符
 * @param {string} name - 原始名称
 * @returns {string} 清理后的名称
 */
function sanitizeName(name) {
    const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    return name
        .replace(config.forbiddenChars, '_')
        .substring(0, config.maxFilenameLength);
}

/**
 * 生成视频文件完整路径
 * @param {string} workId - 作品ID
 * @param {string} authorPath - 作者文件夹路径
 * @returns {string} 视频文件完整路径
 */
export function generateVideoPath(workId, authorPath) {  // ✅ 改为 workId
    const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    const videoFolder = config.mediaTypeFolders.video;
    const fileName = generateNameFromTemplate(config.fileNameFormats.video, { workId });  // ✅ 改为 workId

    return `${authorPath}/${videoFolder}/${fileName}`;
}

/**
 * 生成封面文件完整路径
 * @param {string} workId - 作品ID
 * @param {string} authorPath - 作者文件夹路径
 * @returns {string} 封面文件完整路径
 */
export function generateCoverPath(workId, authorPath) {  // ✅ 改为 workId
    const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    const coverFolder = config.mediaTypeFolders.cover;
    const fileName = generateNameFromTemplate(config.fileNameFormats.cover, { workId });  // ✅ 改为 workId

    return `${authorPath}/${coverFolder}/${fileName}`;
}

/**
 * 生成图集图片文件路径
 * @param {string} workId - 作品ID
 * @param {number} index - 图片索引（从 1 开始）
 * @param {string} authorPath - 作者文件夹路径
 * @returns {string} 图片文件完整路径
 */
export function generateImagePath(workId, index, authorPath) {  // ✅ 改为 workId
    const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    const imagePostFolder = config.mediaTypeFolders.imagePost;
    const paddedIndex = String(index).padStart(2, '0');
    const fileName = generateNameFromTemplate(config.fileNameFormats.image, {
        workId,  // ✅ 改为 workId
        index: paddedIndex
    });

    return `${authorPath}/${imagePostFolder}/${workId}/${fileName}`;  // ✅ 改为 workId
}

/**
 * 生成图集音频文件路径
 * @param {string} workId - 作品ID
 * @param {string} authorPath - 作者文件夹路径
 * @returns {string} 音频文件完整路径
 */
export function generateMusicPath(workId, authorPath) {  // ✅ 改为 workId
    const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    const imagePostFolder = config.mediaTypeFolders.imagePost;
    const fileName = generateNameFromTemplate(config.fileNameFormats.music, { workId });  // ✅ 改为 workId

    return `${authorPath}/${imagePostFolder}/${workId}/${fileName}`;  // ✅ 改为 workId
}
