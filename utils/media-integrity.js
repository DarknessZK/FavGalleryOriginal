// ==========================================
// 媒体文件完整性判定 - 纯逻辑（零依赖，不碰浏览器 / 文件系统）
// 职责：把「整条作品是否已下载」的粗判定，降为「单个文件是否缺失」的细判定，
//       产出「缺件补下计划」——图集缺哪几张（1-based 原序号）、是否需单独补封面 / 音频。
//
// 背景（第 5 步）：旧的跳过判定只看图集首图 / 视频正片是否存在，导致
//   ① 图集第 N 张下载失败后，本地已有首图 → 之后每轮都被判「已存在」整条跳过，缺图永久存在；
//   ② 视频封面缺失时，正片在就整条跳过，封面永不补。
//   本模块只做「该补什么」的决策，实际存在性探测（fileExists）与落盘仍由下载器负责。
//
// 铁律：输出序号一律沿用原有 1-based 落盘序号，绝不重排 ——
//       离线页与本地库都按 workId_01.jpg 这样的序号定位文件，补下必须落回原位。
// ==========================================

/**
 * 归一化为非负整数（脏输入 / NaN / Infinity / 负数一律归零）
 * @param {*} v
 * @returns {number}
 */
function toIndex(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 把「已存在的序号集合」归一化为 Set（仅保留有效正整数）
 * 兼容 Set / 数组 / null / undefined
 * @param {Iterable<*>|null|undefined} existingIndexes
 * @returns {Set<number>}
 */
function toIndexSet(existingIndexes) {
    const set = new Set();
    if (!existingIndexes) return set;
    const iterable =
        existingIndexes instanceof Set ? existingIndexes
            : Array.isArray(existingIndexes) ? existingIndexes
                : typeof existingIndexes[Symbol.iterator] === 'function' ? existingIndexes
                    : [];
    for (const raw of iterable) {
        const n = toIndex(raw);
        if (n > 0) set.add(n);
    }
    return set;
}

/**
 * 图集缺失图片序号：1..imageCount 中不在 existingIndexes 的部分（升序）
 *
 * 注意：imageCount 应传「本轮从详情拿到的有效图片 URL 数」，与落盘序号同源
 *      （下载器保存图片时用的就是同一个过滤后的数组，位置一一稳定）。
 *
 * @param {number} imageCount - 本轮预期的图片张数
 * @param {Iterable<*>} existingIndexes - 本地已存在的 1-based 序号集合
 * @returns {number[]} 缺失的 1-based 序号（升序）
 */
export function computeMissingImageIndexes(imageCount, existingIndexes) {
    const total = toIndex(imageCount);
    if (total <= 0) return [];
    const present = toIndexSet(existingIndexes);
    const missing = [];
    for (let i = 1; i <= total; i++) {
        if (!present.has(i)) missing.push(i);
    }
    return missing;
}

/**
 * 图集补下计划
 * @param {Object} ctx
 * @param {number} ctx.imageCount - 本轮预期图片张数
 * @param {Iterable<*>} [ctx.existingIndexes] - 本地已存在的图片序号集合
 * @param {boolean} [ctx.musicExpected] - 本作品是否应有音频（详情里有 musicUrl 即为真）
 * @param {boolean} [ctx.musicExists] - 音频文件是否已在本地
 * @returns {{missingIndexes: number[], needMusic: boolean, isComplete: boolean}}
 */
export function planImagePostBackfill({
    imageCount = 0,
    existingIndexes = [],
    musicExpected = false,
    musicExists = false
} = {}) {
    const missingIndexes = computeMissingImageIndexes(imageCount, existingIndexes);
    const needMusic = !!musicExpected && !musicExists;
    return {
        missingIndexes,
        needMusic,
        // 全部图片齐 + 该有音频也不缺 → 整条完整，可跳过
        isComplete: missingIndexes.length === 0 && !needMusic
    };
}

/**
 * 视频补下计划（正片与封面各自独立判定，封面缺失可单独补）
 * @param {Object} ctx
 * @param {boolean} ctx.videoExists - 正片文件是否已在本地
 * @param {boolean} [ctx.coverExpected] - 本作品是否应有封面（详情里有 coverUrl 即为真）
 * @param {boolean} [ctx.coverExists] - 封面文件是否已在本地
 * @returns {{needVideo: boolean, needCover: boolean, isComplete: boolean}}
 */
export function planVideoBackfill({
    videoExists = false,
    coverExpected = false,
    coverExists = false
} = {}) {
    const needVideo = !videoExists;
    const needCover = !!coverExpected && !coverExists;
    return {
        needVideo,
        needCover,
        isComplete: !needVideo && !needCover
    };
}
