// ==========================================
// FavGallery - 离线浏览页数据生成器
// 职责：从 IndexedDB 全量导出 → 固化下载状态与本地路径 → 三维分片写入离线数据目录
// 说明：运行于扩展侧（Content Script，兼具 IndexedDB 与文件系统权限）；
//       产物为可被 file:// 页面 <script> 加载的全局变量 .js 分片文件。
//       设计详见 docs/OFFLINE_COLLECTION_VIEWER.md
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { database } from '../database/database.js';
import { fileSystem } from '../storage/file-system.js';
import { createLogger } from '../../utils/logger.js';
import { buildWorkRecord, buildAuthorRecord, getMonthKey } from './offline-record-builder.js';

const logger = createLogger('OfflineDataGenerator');

/**
 * 离线数据文件的全局变量名（离线页 <script> 加载后按此名读取）
 */
export const OFFLINE_VARS = {
    index: 'offline_index',            // 跨平台清单
    manifest: 'offline_manifest',      // 平台内分片清单
    authorsIndex: 'authors_index',     // 作者元数据列表
    authorWorks: 'author_works',       // 单作者作品
    likedWorks: 'liked_works',         // 点赞按月分片
    bookmarkedWorks: 'bookmarked_works', // 收藏按收藏夹分片
    searchIndex: 'search_index'        // 全局搜索索引（跨分片）
};

/**
 * ✅ 浏览器安全序列化：产出形如 varName = <双引号包裹的JSON字符串字面量>;
 *
 * 不复用 fileSystem.serializeData：后者用模板字符串包裹、且转义在 stringify 之前，
 * 当数据含反引号或美元花括号时，浏览器 script 求值模板会因裸反引号提前终止而语法错误，
 * 导致整片分片静默失效。此处改用双层 JSON.stringify 生成双引号字符串字面量，
 * 反引号与美元花括号在双引号字符串中无需转义，浏览器加载安全；
 * 消费端 parseGlobal 仍是 JSON.parse(window[varName])，天然兼容。
 *
 * @param {*} data - 要序列化的数据
 * @param {string} varName - 全局变量名
 * @returns {string} 可被 file:// 页面 script 安全加载的 JS 文本
 */
function serializeForBrowser(data, varName) {
    const json = JSON.stringify(data, (key, value) => (value instanceof Set ? [...value] : value));
    return `${varName} = ${JSON.stringify(json)};\n`;
}

/**
 * ✅ 解析 serializeForBrowser 产物（扩展侧读取 offline-index 用）
 * 双层 JSON.parse：外层还原 JS 字符串字面量为 JSON 文本，内层还原为数据。
 *
 * @param {string} content - 文件内容
 * @param {string} varName - 全局变量名
 * @returns {*} 解析后的数据，失败返回 null
 */
function parseBrowserFile(content, varName) {
    if (!content || content.trim() === '') return null;
    const eq = content.indexOf('=');
    if (eq < 0) return null;
    let literal = content.slice(eq + 1).trim();
    if (literal.endsWith(';')) literal = literal.slice(0, -1);
    try {
        return JSON.parse(JSON.parse(literal));
    } catch (error) {
        logger.warn('⚠️ 解析序列化文件失败:', varName, error?.message || error);
        return null;
    }
}

/**
 * 获取平台离线数据根目录（相对用户根目录）
 * @param {string} platform - 平台标识
 * @returns {string} 形如 .FavGallery/metadata/douyin/offline
 */
function getOfflineBaseDir(platform) {
    return `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/${CONFIG.FILE_SYSTEM.OFFLINE_DIR}`;
}

/**
 * 按 targetType:targetId 建立关系索引
 * @param {Array<Object>} relations - relations 表全量
 * @returns {Map<string, Array<Object>>} 键为 `${targetType}:${targetId}`
 * @private
 */
function _buildRelationsByTarget(relations) {
    const map = new Map();
    for (const r of relations) {
        const key = `${r.targetType}:${r.targetId}`;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(r);
    }
    return map;
}

/**
 * 计算作者下载状态（按正确方向 work→author 的作品集 + completed_works）
 *
 * 注意：不复用 authors-manager.getAuthorDownloadStatus —— 该函数查询方向有误
 * （用 source=['author',uid] 取 targetId），此处按 relations 实际方向自行计算。
 *
 * @param {Array<string>} workIds - 作者的作品 ID 列表
 * @param {Map<string, Object>} completedMap - completed_works 索引
 * @returns {{downloadStatus: string, downloadedCount: number, workCount: number}}
 * @private
 */
function _computeAuthorStatus(workIds, completedMap) {
    const workCount = workIds.length;
    let downloadedCount = 0;
    for (const id of workIds) {
        if (completedMap.has(id)) {
            downloadedCount++;
        }
    }
    let downloadStatus = 'pending';
    if (downloadedCount > 0) {
        downloadStatus = downloadedCount >= workCount ? 'completed' : 'partial';
    }
    return { downloadStatus, downloadedCount, workCount };
}

/**
 * 生成作者维度分片：authors/index.js + authors/{uid}.js
 * @private
 */
async function _generateAuthors(baseDir, authors, relByTarget, worksMap, completedMap, platform, generatedAt) {
    const validAuthors = (authors || []).filter(a => !a.isDeleted);
    // 保持关注顺序（authors 表的 order 字段）
    validAuthors.sort((a, b) => (a.order || 0) - (b.order || 0));

    const authorsIndex = [];
    let worksWritten = 0;
    // ✅ 计数语义：“有已下载作品的作者数 / 作者总数”
    let downloadedAuthors = 0;
    const totalAuthors = validAuthors.length;

    for (const author of validAuthors) {
        const rels = relByTarget.get(`author:${author.uid}`) || [];
        const workIds = rels.filter(r => r.sourceType === 'work').map(r => r.sourceId);
        const status = _computeAuthorStatus(workIds, completedMap);

        // ✅ 只要该作者任一作品已下载（completed_works 命中）就计入“已下载作者”，
        //    不依赖 works 表是否有记录，避免因作品未落 works 表而漏计
        if (workIds.some(id => completedMap.has(id))) {
            downloadedAuthors++;
        }

        // 组装作品展示记录（过滤软删除、跳过 works 表缺失项）
        const workRecords = [];
        for (const id of workIds) {
            const w = worksMap.get(id);
            if (!w || w.isDeleted) {
                continue;
            }
            workRecords.push(buildWorkRecord(w, completedMap.get(id) || null, undefined, platform));
        }
        // ✅ 无有效作品：既不写分片文件，也不进作者索引（作者维度只覆盖有下载作品的作者）
        if (workRecords.length === 0) {
            continue;
        }
        authorsIndex.push(buildAuthorRecord(author, status));
        workRecords.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
        worksWritten += workRecords.length;

        const payload = {
            uid: author.uid,
            nickname: author.nickname || '',
            generatedAt,
            count: workRecords.length,
            works: workRecords
        };
        await fileSystem.writeTextFile(
            `${baseDir}/authors/${author.uid}.js`,
            serializeForBrowser(payload, OFFLINE_VARS.authorWorks)
        );
    }

    const indexPayload = { platform, generatedAt, count: authorsIndex.length, authors: authorsIndex };
    await fileSystem.writeTextFile(
        `${baseDir}/authors/index.js`,
        serializeForBrowser(indexPayload, OFFLINE_VARS.authorsIndex)
    );

    logger.info(`👤 作者维度生成完成: 已下载作者 ${downloadedAuthors}/${totalAuthors}, 入索引 ${authorsIndex.length} 位, ${worksWritten} 个作品分片记录`);
    return { count: authorsIndex.length, worksWritten, downloadedAuthors, totalAuthors };
}

/**
 * 生成点赞维度分片：liked/{yyyy_MM}.js（按点赞时间 relations.createdAt 分月）
 * @private
 */
async function _generateLiked(baseDir, relByTarget, worksMap, completedMap, platform, generatedAt) {
    const rels = (relByTarget.get('liked_group:liked') || []).filter(r => r.sourceType === 'work');

    const byMonth = new Map();
    let total = 0;
    // ✅ 计数语义：“已下载点赞作品数 / 点赞作品总数”
    let downloaded = 0;
    for (const r of rels) {
        const w = worksMap.get(r.sourceId);
        if (!w || w.isDeleted) {
            continue;
        }
        const monthKey = getMonthKey(r.createdAt);
        if (!byMonth.has(monthKey)) {
            byMonth.set(monthKey, []);
        }
        byMonth.get(monthKey).push(buildWorkRecord(w, completedMap.get(r.sourceId) || null, r.createdAt, platform));
        total++;
        if (completedMap.has(r.sourceId)) {
            downloaded++;
        }
    }

    const months = [];
    for (const [monthKey, records] of byMonth) {
        records.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
        const payload = { month: monthKey, generatedAt, count: records.length, works: records };
        await fileSystem.writeTextFile(
            `${baseDir}/liked/${monthKey}.js`,
            serializeForBrowser(payload, OFFLINE_VARS.likedWorks)
        );
        months.push(monthKey);
    }

    // 倒序（近端优先）；unknown 排最后
    months.sort((a, b) => {
        if (a === 'unknown') return 1;
        if (b === 'unknown') return -1;
        return b.localeCompare(a);
    });

    logger.info(`❤️ 点赞维度生成完成: 已下载 ${downloaded}/${total}, ${months.length} 个月份分片`);
    return { count: total, total, downloaded, months };
}

/**
 * 生成收藏维度分片：bookmarked/{collectId}.js
 * @private
 */
async function _generateBookmarked(baseDir, collects, relByTarget, worksMap, completedMap, platform, generatedAt) {
    const validCollects = (collects || []).filter(c => !c.isDeleted);
    // 按收藏夹 sortOrder 排序，保证离线页展示顺序与扩展一致
    validCollects.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const collectInfos = [];
    let total = 0;
    // ✅ 计数语义：“有已下载作品的收藏夹数 / 收藏夹总数”
    const totalCollects = validCollects.length;
    let downloadedCollects = 0;

    for (const collect of validCollects) {
        const rels = (relByTarget.get(`collect:${collect.collectId}`) || []).filter(r => r.sourceType === 'work');
        const records = [];
        let hasDownloaded = false;
        for (const r of rels) {
            // ✅ 只要收藏夹内任一作品已下载就计入“已下载收藏夹”，不依赖 works 表是否有记录
            if (completedMap.has(r.sourceId)) {
                hasDownloaded = true;
            }
            const w = worksMap.get(r.sourceId);
            if (!w || w.isDeleted) {
                continue;
            }
            records.push(buildWorkRecord(w, completedMap.get(r.sourceId) || null, r.createdAt, platform));
        }
        records.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
        if (hasDownloaded) {
            downloadedCollects++;
        }

        collectInfos.push({
            collectId: collect.collectId,
            collectName: collect.collectName || '',
            workCount: records.length
        });

        if (records.length === 0) {
            continue; // 空收藏夹不写分片文件（仍保留在清单中）
        }
        total += records.length;

        const payload = {
            collectId: collect.collectId,
            collectName: collect.collectName || '',
            generatedAt,
            count: records.length,
            works: records
        };
        await fileSystem.writeTextFile(
            `${baseDir}/bookmarked/${collect.collectId}.js`,
            serializeForBrowser(payload, OFFLINE_VARS.bookmarkedWorks)
        );
    }

    logger.info(`📁 收藏维度生成完成: 已下载收藏夹 ${downloadedCollects}/${totalCollects}, 作品 ${total} 条`);
    return { count: total, totalCollects, downloadedCollects, collects: collectInfos };
}

/**
 * 生成全局搜索索引 search-index.js（文档 8.4：首次全局搜索时懒加载整个库）
 *
 * 离线页的分片内搜索只覆盖已加载范围；本文件供跨分片全局搜索。
 * 每行仅保留检索/定位字段做瘦身：src 形如 'l:{月份}' 点赞 / 'b:{collectId}' 收藏 / 'a:{uid}' 作者，
 * 消费端据此加载对应分片取回完整展示记录；desc 截前 120 字（全局搜索匹配可见部分，
 * 完整文本仍可用分片内搜索）；workId 去重，维度优先级：点赞 > 收藏 > 作者（任一分片均可取回全记录）。
 * @private
 */
async function _generateSearchIndex(baseDir, relByTarget, worksMap, platform, generatedAt) {
    const seen = new Set();
    const entries = [];
    const pushWork = (w, src) => {
        if (seen.has(w.workId)) return;
        seen.add(w.workId);
        entries.push({
            workId: w.workId,
            desc: (w.desc || '').slice(0, 120),
            authorNickname: w.author?.nickname || '',
            src
        });
    };
    const validWork = (id) => {
        const w = worksMap.get(id);
        return (w && !w.isDeleted) ? w : null;
    };

    // 1. 点赞维度（每月必有 liked/{月份}.js 分片）
    for (const r of relByTarget.get('liked_group:liked') || []) {
        if (r.sourceType !== 'work') continue;
        const w = validWork(r.sourceId);
        if (w) pushWork(w, `l:${getMonthKey(r.createdAt)}`);
    }
    // 2. 收藏维度（relByTarget 键形如 collect:{id}；推入条件与分片写入条件一致，分片必存在）
    for (const [key, rels] of relByTarget) {
        if (!key.startsWith('collect:')) continue;
        const collectId = key.slice('collect:'.length);
        for (const r of rels) {
            if (r.sourceType !== 'work') continue;
            const w = validWork(r.sourceId);
            if (w) pushWork(w, `b:${collectId}`);
        }
    }
    // 3. 作者维度（仅收录有有效作品的作者，与本条件同源，authors/{uid}.js 必存在）
    for (const [key, rels] of relByTarget) {
        if (!key.startsWith('author:')) continue;
        const uid = key.slice('author:'.length);
        for (const r of rels) {
            if (r.sourceType !== 'work') continue;
            const w = validWork(r.sourceId);
            if (w) pushWork(w, `a:${uid}`);
        }
    }

    const payload = { platform, generatedAt, count: entries.length, entries };
    await fileSystem.writeTextFile(
        `${baseDir}/search-index.js`,
        serializeForBrowser(payload, OFFLINE_VARS.searchIndex)
    );
    logger.info(`🔎 全局搜索索引生成完成: ${entries.length} 条`);
    return { count: entries.length };
}

/**
 * 更新跨平台清单 offline-index.js（合并保留其他平台条目）
 * @private
 */
async function _updateOfflineIndex(platform, generatedAt, counts) {
    const indexPath = CONFIG.FILE_SYSTEM.OFFLINE_INDEX_FILE;
    let platforms = [];

    try {
        const existing = await fileSystem.readTextFile(indexPath);
        if (existing) {
            const parsed = parseBrowserFile(existing, OFFLINE_VARS.index);
            if (parsed && Array.isArray(parsed.platforms)) {
                platforms = parsed.platforms;
            }
        }
    } catch (error) {
        logger.warn('⚠️ 读取现有 offline-index 失败，将重建:', error?.message || '未知错误');
    }

    const entry = {
        platform,
        name: CONFIG.PLATFORM_INFO?.[platform]?.name || platform,
        dataPath: getOfflineBaseDir(platform),
        generatedAt,
        counts
    };

    const idx = platforms.findIndex(p => p.platform === platform);
    if (idx >= 0) {
        platforms[idx] = entry;
    } else {
        platforms.push(entry);
    }

    await fileSystem.writeTextFile(
        indexPath,
        serializeForBrowser({ generatedAt, platforms }, OFFLINE_VARS.index)
    );
    logger.info(`🌐 跨平台清单已更新: ${platforms.length} 个平台`);
}

/**
 * 生成离线浏览页数据（主入口）
 *
 * 从 IndexedDB 全量读取 authors/collects/works/completed_works/relations，
 * 组装三维分片并写入 metadata/{platform}/offline/，同时刷新跨平台清单。
 * 每次调用为全量重生成（DB 为唯一真相源，产物为派生快照）。
 *
 * @param {string} [platform] - 平台标识（默认当前激活平台）
 * @returns {Promise<Object>} { success, platform?, counts?, duration?, reason?, error? }
 */
let _isGenerating = false;

export async function generateOfflineData(platform = CONFIG.ACTIVE_PLATFORM) {
    // ✅ 并发保护：生成过程较重（全量导出+分片写盘），避免多触发点重叠执行
    if (_isGenerating) {
        logger.warn('⚠️ 已有离线数据生成任务进行中，跳过本次触发');
        return { success: false, reason: 'in_progress' };
    }

    if (!fileSystem.hasDirectoryPermission()) {
        logger.warn('⚠️ 未设置根目录，跳过离线数据生成');
        return { success: false, reason: 'no_root_directory' };
    }

    _isGenerating = true;
    const startTime = Date.now();
    try {
        await fileSystem.initDatabase();

        // 1. 全量读表（扩展侧直接读 IndexedDB，无需解析 ndjson/json 备份）
        const [authors, collects, works, completedWorks, relations] = await Promise.all([
            database.getAll('authors'),
            database.getAll('collects'),
            database.getAll('works'),
            database.getAll('completed_works'),
            database.getAll('relations')
        ]);

        // 2. 建内存索引
        const worksMap = new Map(works.map(w => [w.workId, w]));
        const completedMap = new Map(completedWorks.map(c => [c.workId, c]));
        const relByTarget = _buildRelationsByTarget(relations);
        const generatedAt = Date.now();
        const baseDir = getOfflineBaseDir(platform);

        // 3. 三维分片生成
        const authorsResult = await _generateAuthors(baseDir, authors, relByTarget, worksMap, completedMap, platform, generatedAt);
        const likedResult = await _generateLiked(baseDir, relByTarget, worksMap, completedMap, platform, generatedAt);
        const bookmarkedResult = await _generateBookmarked(baseDir, collects, relByTarget, worksMap, completedMap, platform, generatedAt);
        // 3.5 全局搜索索引（跨维度 workId 去重，供离线页懒加载）
        const searchIndexResult = await _generateSearchIndex(baseDir, relByTarget, worksMap, platform, generatedAt);

        // 4. 平台内分片清单
        // ✅ 三维计数统一为 { downloaded, total } 语义：
        //    点赞=已下载作品/点赞作品总数；作者=有下载作品的作者/关注作者总数；收藏夹=有下载作品的收藏夹/收藏夹总数
        const counts = {
            authors: { downloaded: authorsResult.downloadedAuthors, total: authorsResult.totalAuthors },
            liked: { downloaded: likedResult.downloaded, total: likedResult.total },
            bookmarked: { downloaded: bookmarkedResult.downloadedCollects, total: bookmarkedResult.totalCollects }
        };
        const manifest = {
            platform,
            generatedAt,
            counts,
            likedMonths: likedResult.months,
            collects: bookmarkedResult.collects,
            authorsIndex: 'authors/index.js',
            searchIndex: 'search-index.js',
            searchIndexCount: searchIndexResult.count
        };
        await fileSystem.writeTextFile(
            `${baseDir}/manifest.js`,
            serializeForBrowser(manifest, OFFLINE_VARS.manifest)
        );

        // 5. 跨平台清单
        await _updateOfflineIndex(platform, generatedAt, counts);

        const duration = Date.now() - startTime;
        logger.info(`✅ 离线数据生成完成 (平台:${platform}, 作者:${counts.authors.downloaded}/${counts.authors.total}, 点赞:${counts.liked.downloaded}/${counts.liked.total}, 收藏:${counts.bookmarked.downloaded}/${counts.bookmarked.total}, 耗时:${duration}ms)`);
        return { success: true, platform, counts, duration };
    } catch (error) {
        logger.error('❌ 离线数据生成失败:', error);
        logger.error('   错误消息:', error?.message || '无消息');
        return { success: false, error: error?.message || String(error) };
    } finally {
        _isGenerating = false;
    }
}

export default {
    generateOfflineData,
    OFFLINE_VARS
};
