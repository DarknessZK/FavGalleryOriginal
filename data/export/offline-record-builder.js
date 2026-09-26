// ==========================================
// FavGallery - 离线浏览页记录构建器
// 职责：把 IndexedDB 的原始记录转换为离线页可直接渲染的"自包含展示记录"
// 说明：纯函数模块，不做 I/O；下载状态与本地路径在此固化（离线页无 IndexedDB）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { sanitizeForFileSystem } from '../../utils/helpers.js';

/**
 * 解析作品的本地作者目录（相对根目录，形如 抖音/昵称(uid)）
 *
 * 优先复用 completed_works.filePath 的前两段（下载时固化，作者改名后仍准确）；
 * 图集作品的 filePath 为空（下载器未回传），此时按配置确定性重建，
 * 规则与 single-downloader 的 generate*Path 完全一致。
 *
 * @param {Object} work - works 表记录
 * @param {Object|null} completed - completed_works 记录
 * @param {string} platform - 平台标识
 * @returns {string|null} 本地作者目录；无法解析返回 null
 */
export function resolveLocalBaseDir(work, completed, platform) {
    // 1. 优先用已下载文件的真实路径前缀（平台目录 / 作者目录）
    const filePath = completed?.filePath;
    if (filePath) {
        const parts = String(filePath).split('/').filter(p => p.length > 0);
        if (parts.length >= 2) {
            return `${parts[0]}/${parts[1]}`;
        }
    }
    // 2. 回退：按配置重建（图集作品 filePath 为空时走这里）
    const platformName = CONFIG.PLATFORM_INFO?.[platform]?.name || platform;
    if (!platformName) {
        return null;
    }
    const author = work?.author || {};
    const uid = author.uid || author.platformId || 'unknown';
    const safeNickname = sanitizeForFileSystem(author.nickname || '未知用户');
    return `${platformName}/${safeNickname}(${uid})`;
}

/**
 * 派生作品的本地媒体路径集合（封面 / 视频 / 图集 / 音乐）
 *
 * 目录与命名规则严格对齐 single-downloader 的 generate*Path：
 * - 视频：{base}/视频/{workId}.mp4，封面 {base}/封面/{workId}_cover.jpg
 * - 图集：{base}/图集/{workId}/{workId}_{index}.jpg，封面取首图 _01，
 *         音乐 {base}/图集/{workId}/{workId}.mp3（仅当作品含音频）
 *
 * @param {Object} work - works 表记录
 * @param {Object|null} completed - completed_works 记录
 * @param {string} platform - 平台标识
 * @returns {Object} { localCoverPath?, localMediaPath?, localImageDir?, imageCount?, localMusicPath? }
 */
export function deriveLocalPaths(work, completed, platform) {
    const result = {};
    const base = resolveLocalBaseDir(work, completed, platform);
    if (!base) {
        return result;
    }

    const workId = work.workId;
    const fsCfg = CONFIG.DOWNLOAD_CONFIG.fileSystem;
    const folders = fsCfg.mediaTypeFolders;
    const formats = fsCfg.fileNameFormats;
    const isImagePost = completed?.mediaType === 'image_post' || (!completed && work.isImagePost);

    if (isImagePost) {
        const imageDir = `${base}/${folders.imagePost}/${workId}`;
        const firstImage = formats.image.replace('{workId}', workId).replace('{index}', '01');
        result.localImageDir = imageDir;
        result.localCoverPath = `${imageDir}/${firstImage}`;
        result.imageCount = Array.isArray(work.images) ? work.images.length : 0;
        // 音乐仅图集作品下载时保存，且需作品本身含音频
        if (work.music?.audioUrl) {
            const musicName = formats.music.replace('{workId}', workId);
            result.localMusicPath = `${imageDir}/${musicName}`;
        }
    } else {
        const videoName = formats.video.replace('{workId}', workId);
        result.localMediaPath = completed?.filePath || `${base}/${folders.video}/${videoName}`;
        const coverName = formats.cover.replace('{workId}', workId);
        result.localCoverPath = `${base}/${folders.cover}/${coverName}`;
    }

    return result;
}

/**
 * 由毫秒时间戳生成"年_月"分片键（用于点赞列表按时间分片）
 *
 * @param {number} timestamp - 毫秒级时间戳
 * @returns {string} 形如 "2026_09"；非法时间戳返回 "unknown"
 */
export function getMonthKey(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') {
        return 'unknown';
    }
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}_${month}`;
}

/**
 * 构建作品展示记录（自包含，供离线页卡片直接渲染）
 *
 * @param {Object} work - works 表原始记录
 * @param {Object|null} completed - completed_works 中对应记录（未下载为 null）
 * @param {number} [sortTime] - 列表排序时间（点赞/收藏时间，来自 relations.createdAt）
 * @param {string} [platform] - 平台标识（用于本地路径重建）
 * @returns {Object} 精简展示记录
 */
export function buildWorkRecord(work, completed, sortTime, platform) {
    const workId = work.workId;
    const isDownloaded = !!completed;
    const authorUid = work.author?.uid || '';
    const authorNickname = work.author?.nickname || '';

    // 封面远程 URL：视频取 video.coverUrl，图集取首图
    const firstImage = Array.isArray(work.images) && work.images.length > 0
        ? (typeof work.images[0] === 'object' ? (work.images[0].url || '') : work.images[0])
        : '';
    const remoteCover = work.video?.coverUrl || firstImage || '';

    const record = {
        workId,
        desc: work.desc || '',
        createTime: work.createTime || 0,
        authorUid,
        authorNickname,
        isImagePost: !!work.isImagePost,
        mediaType: completed?.mediaType || (work.isImagePost ? 'image_post' : 'video'),
        coverUrl: remoteCover,
        pageUrl: work.video?.pageUrl || '',
        isDownloaded
    };

    // 统计数据（存在才带，进一步瘦身）
    if (work.statistics) {
        record.statistics = {
            playCount: work.statistics.playCount || 0,
            likeCount: work.statistics.likeCount || 0,
            commentCount: work.statistics.commentCount || 0,
            shareCount: work.statistics.shareCount || 0
        };
    }

    // 音乐元数据（含远程 URL，供本地音频缺失时回退）
    if (work.music?.audioUrl || work.music?.title) {
        record.music = {
            title: work.music.title || '',
            author: work.music.author || '',
            audioUrl: work.music.audioUrl || ''
        };
    }

    // 本地路径：仅在已下载时固化（封面/视频/图集/音乐）
    if (isDownloaded) {
        Object.assign(record, deriveLocalPaths(work, completed, platform));
    }

    // 排序时间（点赞/收藏时间），供离线页时间维度排序
    if (typeof sortTime === 'number') {
        record.sortTime = sortTime;
    }

    return record;
}

/**
 * 构建作者展示记录（用于 authors/index.js 作者列表）
 *
 * @param {Object} author - authors 表原始记录
 * @param {Object} status - 下载状态 { downloadStatus, downloadedCount, workCount }
 * @returns {Object} 作者展示记录
 */
export function buildAuthorRecord(author, status) {
    return {
        uid: author.uid,
        nickname: author.nickname || '',
        avatarUrl: author.avatarUrl || '',
        followerCount: author.followerCount || 0,
        followingCount: author.followingCount || 0,
        workCount: status?.workCount || 0,
        downloadedCount: status?.downloadedCount || 0,
        downloadStatus: status?.downloadStatus || 'pending'
    };
}

export default {
    resolveLocalBaseDir,
    deriveLocalPaths,
    getMonthKey,
    buildWorkRecord,
    buildAuthorRecord
};
