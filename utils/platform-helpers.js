// ==========================================
// FavGallery - 跨平台通用辅助函数
// 职责：提供所有平台都可能用到的通用工具函数
// ==========================================

// ===== 内部辅助函数（不导出，仅供内部使用）=====

/**
 * 提取音乐信息
 * @private
 */
function _extractMusic(musicData) {
    if (!musicData) {
        return { title: '', author: '', audioUrl: '' };
    }

    return {
        title: musicData.title || '',
        author: musicData.author || '',
        audioUrl: musicData.play_url?.url_list?.[0] || musicData.audioUrl || ''
    };
}

/**
 * 提取作者信息
 * @private
 */
function _extractAuthor(authorData) {
    if (!authorData) {
        return { uid: '', platformId: '', nickname: '' };
    }

    return {
        uid: authorData.uid || authorData.user_id || '',
        platformId: authorData.sec_uid || '',  // ✅ 只保留 sec_uid
        nickname: authorData.nickname || authorData.nick_name || ''
    };
}

/**
 * 提取统计信息
 * @private
 */
function _extractStatistics(statsData) {
    if (!statsData) {
        return { playCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 };
    }

    return {
        playCount: statsData.play_count || 0,  // ✅ 只保留下划线命名
        likeCount: statsData.digg_count || 0,  // ✅ 只保留 digg_count
        commentCount: statsData.comment_count || 0,  // ✅ 只保留下划线命名
        shareCount: statsData.share_count || 0  // ✅ 只保留下划线命名
    };
}

/**
 * 提取视频信息
 * @private
 */
function _extractVideo(videoData, getUrlQualitySelector) {
    if (!videoData) {
        return { pageUrl: '', coverUrl: '', duration: 0, width: 0, height: 0 };
    }

    const coverUrlData = videoData.cover || videoData.origin_cover;  // ✅ 封面 URL
    
    // ✅ 提取视频播放 URL（从 play_addr 或 bit_rate）
    let playUrl = '';
    const playAddr = videoData.play_addr;
    if (playAddr?.url_list && playAddr.url_list.length > 0) {
        playUrl = getUrlQualitySelector(playAddr.url_list);
    } else if (videoData.bit_rate && videoData.bit_rate.length > 0) {
        // 降级：从 bit_rate 中获取
        const firstBitRate = videoData.bit_rate[0];
        if (firstBitRate.play_addr?.url_list) {
            playUrl = getUrlQualitySelector(firstBitRate.play_addr.url_list);
        }
    }

    return {
        pageUrl: '',  // ✅ 将在 normalizeVideoData 中设置
        play_addr: playUrl ? { url_list: [playUrl] } : undefined,  // ✅ 添加 play_addr 结构
        coverUrl: getUrlQualitySelector(coverUrlData?.url_list || []),
        duration: videoData.duration || 0,
        width: videoData.width || 0,
        height: videoData.height || 0
    };
}

/**
 * 提取图片列表
 * @private
 */
function _extractImages(imagesData) {
    if (!imagesData || !Array.isArray(imagesData)) {
        return null;
    }

    // ✅ 图片专用的画质选择器（与旧项目保持一致）
    // 优先级：origin > 1080 > high > large > 第一个
    const selectImageQuality = (urlList) => {
        if (!urlList || urlList.length === 0) {
            return '';
        }
        
        const priorityKeywords = ['origin', '1080', 'high', 'large'];
        
        for (const keyword of priorityKeywords) {
            for (const url of urlList) {
                if (url.includes(keyword)) {
                    return url;
                }
            }
        }
        
        // 如果没有匹配的，返回第一个
        return urlList[0];
    };

    return imagesData.map(img => {
        const urlList = img.url_list || img.display_image?.url_list || [];
        return {
            url: selectImageQuality(urlList),  // ✅ 使用图片专用选择器
            width: img.width || 0,
            height: img.height || 0
        };
    });
}

// ===== 对外导出的公共函数 =====

/**
 * 从 URL 列表中选择最高质量的资源
 *
 * @param {Array<string>} urlList - URL 列表
 * @param {Array<string>} priorityKeywords - 优先级关键词数组（按优先级排序）
 * @returns {string} 选中的 URL，如果列表为空则返回空字符串
 *
 * @example
 * // 抖音图片
 * selectHighestQualityUrl(urls, ['origin', '1080', 'high', 'large'])
 *
 * // 抖音视频
 * selectHighestQualityUrl(urls, ['v2', 'origin'])
 */
export function selectHighestQualityUrl(urlList, priorityKeywords = []) {
    if (!urlList || urlList.length === 0) {
        return '';
    }

    // 如果没有指定优先级，直接返回第一个
    if (priorityKeywords.length === 0) {
        return urlList[0];
    }

    // 按优先级查找匹配的 URL
    for (const keyword of priorityKeywords) {
        for (const url of urlList) {
            if (url.includes(keyword)) {
                return url;
            }
        }
    }

    // 如果没有匹配的，返回第一个
    return urlList[0];
}

/**
 * 标准化视频数据结构
 * 将不同平台的原始视频数据转换为统一格式
 *
 * @param {Object} rawData - 原始视频数据
 * @param {Object} options - 配置选项
 * @param {Function} options.getUrlQualitySelector - URL 质量选择器函数
 * @param {Object} options.fieldMapping - 字段映射配置
 * @returns {Object} 标准化的视频数据
 *
 * @example
 * const video = normalizeVideoData(rawVideo, {
 *     getUrlQualitySelector: (urls) => selectHighestQualityUrl(urls, ['origin']),
 *     fieldMapping: {
 *         id: 'aweme_id',
 *         description: 'desc'
 *     }
 * })
 */
export function normalizeVideoData(rawData, options = {}) {
    const {
        getUrlQualitySelector = (urls) => urls?.[0] || '',
        fieldMapping = {}
    } = options;

    // 默认字段映射（抖音格式）
    const defaultMapping = {
        id: 'aweme_id',
        description: 'desc',
        createTime: 'create_time',
        author: 'author',
        statistics: 'statistics',
        video: 'video',
        images: 'images',
        music: 'music'
    };

    const mapping = { ...defaultMapping, ...fieldMapping };

    // 提取各模块原始数据
    const authorData = rawData[mapping.author];
    const statsData = rawData[mapping.statistics];
    const videoData = rawData[mapping.video];
    const imagesData = rawData[mapping.images];
    const musicData = rawData[mapping.music];

    // 使用内部辅助函数提取并标准化
    const images = _extractImages(imagesData);  // ✅ 图片使用内置选择器
    const video = _extractVideo(videoData, getUrlQualitySelector);
    
    // ✅ 设置 video.pageUrl 为作品页面跳转链接
    if (video && rawData.share_url) {
        video.pageUrl = rawData.share_url;
    }

    return {
        workId: rawData[mapping.id],                    // ✅ 改为 workId
        desc: rawData[mapping.description] || '',
        createTime: rawData[mapping.createTime] || 0,

        // 使用内部函数提取
        author: _extractAuthor(authorData),
        statistics: _extractStatistics(statsData),
        video,
        images,
        isImagePost: !!(images && images.length > 0),
        music: _extractMusic(musicData)
    };
}

/**
 * 标准化作者/用户数据结构
 *
 * @param {Object} rawData - 原始作者数据
 * @param {Object} options - 配置选项
 * @param {Object} options.fieldMapping - 字段映射配置
 * @returns {Object} 标准化的作者数据
 */
export function normalizeAuthorData(rawData, options = {}) {
    const { fieldMapping = {} } = options;

    // 默认字段映射（抖音格式）
    const defaultMapping = {
        uid: 'uid',
        platformId: 'sec_uid',              // ✅ 改为 platformId
        uniqueId: 'unique_id',
        nickname: 'nickname',
        avatarUrl: 'avatar_larger',         // ✅ 优先使用最大头像
        signature: 'signature',
        followerCount: 'follower_count',
        followingCount: 'following_count',
        workCount: 'aweme_count',           // ✅ 改为 workCount
        totalFavorited: 'total_favorited'
    };

    const mapping = { ...defaultMapping, ...fieldMapping };

    // 提取头像 URL（支持多分辨率选择，按优先级降级）
    const avatarData = rawData[mapping.avatarUrl] || rawData['avatar_medium'] || rawData['avatar_thumb'];
    let avatarUrl = '';
    
    if (Array.isArray(avatarData?.url_list)) {
        // ✅ 智能选择最高画质：1080 > 720 > origin > large > 第一个
        for (const quality of ['1080', '720', 'origin', 'large']) {
            const matched = avatarData.url_list.find(url => url.includes(quality));
            if (matched) {
                avatarUrl = matched;
                break;
            }
        }
        // 如果没有匹配，使用第一个
        if (!avatarUrl && avatarData.url_list.length > 0) {
            avatarUrl = avatarData.url_list[0];
        }
    } else if (typeof avatarData === 'string') {
        avatarUrl = avatarData;
    }

    return {
        uid: rawData[mapping.uid] || '',
        platformId: rawData[mapping.platformId] || rawData[mapping.platformId.replace('_', '')] || '',  // ✅ 改为 platformId
        uniqueId: rawData[mapping.uniqueId] || rawData[mapping.uniqueId.replace('_', '')] || '',
        nickname: rawData[mapping.nickname] || '',
        avatarUrl,
        signature: rawData[mapping.signature] || '',
        followerCount: rawData[mapping.followerCount] || rawData[mapping.followerCount.replace('_', '')] || 0,
        followingCount: rawData[mapping.followingCount] || rawData[mapping.followingCount.replace('_', '')] || 0,
        workCount: rawData[mapping.workCount] || rawData[mapping.workCount.replace('work', 'aweme').replace('_', '')] || 0,  // ✅ 改为 workCount
        totalFavorited: rawData[mapping.totalFavorited] || rawData[mapping.totalFavorited.replace('_', '')] || 0
    };
}

/**
 * 从嵌套对象中安全获取值
 *
 * @param {Object} obj - 目标对象
 * @param {string} path - 路径（如 'app.user.info'）
 * @param {*} defaultValue - 默认值
 * @returns {*} 获取的值或默认值
 *
 * @example
 * const value = safeGet(window.SSR_RENDER_DATA, 'app.user.info.uid')
 */
export function safeGet(obj, path, defaultValue = null) {
    if (!obj || !path) return defaultValue;

    const keys = path.split('.');
    let result = obj;

    for (const key of keys) {
        if (result === null || result === undefined) {
            return defaultValue;
        }
        result = result[key];
    }

    return result !== undefined ? result : defaultValue;
}

/**
 * 延迟执行
 *
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
