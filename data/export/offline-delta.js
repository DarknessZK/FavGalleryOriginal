// ==========================================
// FavGallery - 离线浏览页数据增量更新器
// 职责：在稳态下只重建"受影响"的分片，避免每次下载/浏览都全量重写整个离线数据目录
//
// 设计（详见 docs/FEATURE_COMPLETENESS.md 与离线数据增量更新方案）：
//   - 变更点（works 保存、关系增删、下载完成）调用 markOfflineDirty 登记"脏 workId + 涉及分片桶"；
//     脏清单落 settings 表一条记录（database.useAccount 天然按账号隔离），直连读写、绕开备份抖动。
//   - flushOfflineDelta 合并处理脏清单：只对受影响分片按库当前真值"整片重建"（其余分片文件不动），
//     小体量聚合文件（authors/index、manifest、offline-index）通过只读小对象表（relations/authors/
//     collects/completed_works，不读 works）重算，search-index 则按脏 workId 定点修补。
//   - 全量重写仅在"目录为空/首次种子"时由 generateOfflineData 承担（ensureOfflineData 判定）。
//
// 运行于扩展侧（Content Script，兼具 IndexedDB 与文件系统权限）。
// 依赖方向：offline-delta → {database, fileSystem, generator 工具, record-builder}，
//           反向模块（works-manager / relation-manager / database / main / author-service）引用本模块时，
//           database 用动态 import 打破 offline-delta ↔ database 的静态循环。
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { database } from '../database/database.js';
import { fileSystem } from '../storage/file-system.js';
import { createLogger } from '../../utils/logger.js';
import { buildWorkRecord, buildAuthorRecord, getMonthKey } from './offline-record-builder.js';
import {
    OFFLINE_VARS,
    serializeForBrowser,
    parseBrowserFile,
    getOfflineBaseDir,
    generateOfflineData
} from './offline-data-generator.js';

const logger = createLogger('OfflineDelta');

// 脏清单在 settings 表中的键
const DELTA_KEY = 'offline-delta';

// ==========================================
// 脏清单（内存镜像 + settings 持久化）
// ==========================================

// _workIds: Set<string> 变更过的作品 ID
// _buckets: Map<string, {kind,key}> 明确记录的受影响分片桶（关系删除当场登记，防止事后无从定位）
let _workIds = new Set();
let _buckets = new Map();
let _hydrated = false;
let _flushing = false;
let _again = false;

const bucketKey = (kind, key) => `${kind}:${key}`;

/**
 * 从 settings 表装载脏清单到内存（仅一次）
 * @private
 */
async function _hydrate() {
    if (_hydrated) return;
    try {
        const rec = await database.get('settings', DELTA_KEY);
        const v = rec?.value;
        if (v) {
            (v.workIds || []).forEach(id => _workIds.add(id));
            (v.buckets || []).forEach(b => _buckets.set(bucketKey(b.kind, b.key), b));
        }
    } catch (error) {
        logger.warn('⚠️ 装载脏清单失败（按空处理）:', error?.message || error);
    }
    _hydrated = true;
}

/**
 * 将内存脏清单持久化到 settings（直连，不触发备份）
 * @private
 */
async function _persistLedger() {
    const value = {
        workIds: [..._workIds],
        buckets: [..._buckets.values()],
        updatedAt: Date.now()
    };
    await database.save('settings', { key: DELTA_KEY, value });
}

/**
 * 登记离线数据变更（各写库入口调用）
 *
 * @param {Array<string>|string} workIds - 变更的作品 ID
 * @param {Array<{kind:string,key:string}>} [buckets] - 明确涉及的受影响分片桶（关系删除必须传入被移除的桶）
 * @returns {Promise<void>}
 */
export async function markOfflineDirty(workIds, buckets) {
    try {
        await _hydrate();
        const ids = Array.isArray(workIds) ? workIds : [workIds];
        let touched = false;
        for (const id of ids) {
            if (id && !_workIds.has(id)) { _workIds.add(id); touched = true; }
        }
        for (const b of (buckets || [])) {
            if (!b || !b.kind || b.key === undefined) continue;
            const k = bucketKey(b.kind, b.key);
            if (!_buckets.has(k)) { _buckets.set(k, b); touched = true; }
        }
        // 仅在确有新增时落盘，减少热路径写放大
        if (touched) await _persistLedger();
    } catch (error) {
        // 绝不因为脏登记失败而中断下载/浏览主流程
        logger.warn('⚠️ 登记离线脏数据失败（忽略）:', error?.message || error);
    }
}

// ==========================================
// 分片桶与关系辅助
// ==========================================

/**
 * 由一条 work→target 关系推导其分片桶（非作品来源或分组类目标返回 null）
 * @private
 */
function _relationToBucket(rel) {
    if (rel.sourceType !== 'work') return null;
    if (rel.targetType === 'liked_group' && rel.targetId === 'liked') {
        return { kind: 'liked', key: getMonthKey(rel.createdAt), createdAt: rel.createdAt };
    }
    if (rel.targetType === 'collect') {
        return { kind: 'collect', key: rel.targetId, createdAt: rel.createdAt };
    }
    if (rel.targetType === 'author') {
        return { kind: 'author', key: rel.targetId };
    }
    return null;
}

/**
 * 取某作品当前的所有分片桶（出边关系）
 * @private
 */
async function _bucketsOfWork(workId) {
    const rels = await database.getByIndex('relations', 'source', ['work', workId]);
    const out = [];
    for (const r of (rels || [])) {
        const b = _relationToBucket(r);
        if (b) out.push(b);
    }
    return out;
}

// ==========================================
// 受影响分片"整片重建"
// ==========================================

/**
 * 读取并解析一个分片文件（不存在/解析失败返回 null）
 * @private
 */
async function _readShard(path, varName) {
    try {
        const content = await fileSystem.readTextFile(path);
        return parseBrowserFile(content, varName);
    } catch (_) {
        return null;
    }
}

/**
 * 按成员（{id, sortTime?} 数组）组装有效作品展示记录（跳过缺失/软删除）
 * @param {Array<{id:string,sortTime?:number}>} members - 成员列表（id 为 workId）
 * @private
 */
async function _buildRecordsFor(members, platform, useSortTime) {
    if (members.length === 0) return { records: [], downloaded: 0 };
    const ids = members.map(m => (typeof m === 'string' ? m : m.id));
    const [works, completedList] = await Promise.all([
        database.getByIds('works', ids),
        database.getByIds('completed_works', ids)
    ]);
    const workMap = new Map(works.map(w => [w.workId, w]));
    const completedMap = new Map((completedList || []).map(c => [c.workId, c]));

    const records = [];
    let downloaded = 0;
    for (const m of members) {
        const id = typeof m === 'string' ? m : m.id;
        const w = workMap.get(id);
        if (!w || w.isDeleted) continue;
        const completed = completedMap.get(id) || null;
        if (completed) downloaded++;
        records.push(buildWorkRecord(w, completed, useSortTime ? m.sortTime : undefined, platform));
    }
    return { records, downloaded };
}

/**
 * 重建点赞月份分片；空则删除分片文件
 * @private
 */
async function _rebuildLikedShard(baseDir, month, platform, generatedAt) {
    const rels = await database.getByIndex('relations', 'target', ['liked_group', 'liked']);
    const members = (rels || [])
        .filter(r => r.sourceType === 'work' && getMonthKey(r.createdAt) === month)
        .map(r => ({ id: r.sourceId, sortTime: r.createdAt }));
    const { records, downloaded } = await _buildRecordsFor(members, platform, true);
    records.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

    const path = `${baseDir}/liked/${month}.js`;
    if (records.length === 0) {
        try { await fileSystem.removeFile(path); } catch (_) { /* 本就不存在 */ }
    } else {
        await fileSystem.writeTextFile(path, serializeForBrowser(
            { month, generatedAt, count: records.length, works: records }, OFFLINE_VARS.likedWorks));
    }
    return { downloaded, total: records.length };
}

/**
 * 重建作者作品分片；空则删除分片文件。返回该作者的索引统计（供 authors/index 重算）
 * @private
 */
async function _rebuildAuthorShard(baseDir, uid, platform, generatedAt) {
    const rels = await database.getByIndex('relations', 'target', ['author', uid]);
    const ids = (rels || []).filter(r => r.sourceType === 'work').map(r => r.sourceId);
    const { records, downloaded } = await _buildRecordsFor(ids, platform, false);
    records.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));

    const path = `${baseDir}/authors/${uid}.js`;
    if (records.length === 0) {
        try { await fileSystem.removeFile(path); } catch (_) { /* 本就不存在 */ }
    } else {
        const author = await database.get('authors', uid);
        await fileSystem.writeTextFile(path, serializeForBrowser(
            { uid, nickname: author?.nickname || '', generatedAt, count: records.length, works: records },
            OFFLINE_VARS.authorWorks));
    }
    return { workIds: ids, validCount: records.length, downloaded };
}

/**
 * 重建收藏夹作品分片；空则删除分片文件
 * @private
 */
async function _rebuildCollectShard(baseDir, collectId, platform, generatedAt) {
    const rels = await database.getByIndex('relations', 'target', ['collect', collectId]);
    const members = (rels || [])
        .filter(r => r.sourceType === 'work')
        .map(r => ({ id: r.sourceId, sortTime: r.createdAt }));
    const { records, downloaded } = await _buildRecordsFor(members, platform, true);
    records.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

    const path = `${baseDir}/bookmarked/${collectId}.js`;
    if (records.length === 0) {
        try { await fileSystem.removeFile(path); } catch (_) { /* 本就不存在 */ }
    } else {
        const collect = await database.get('collects', collectId);
        await fileSystem.writeTextFile(path, serializeForBrowser(
            { collectId, collectName: collect?.collectName || '', generatedAt, count: records.length, works: records },
            OFFLINE_VARS.bookmarkedWorks));
    }
    return { downloaded: downloaded > 0, workCount: records.length };
}

// ==========================================
// 聚合小文件重建（只读小对象表，不读 works 对象）
// ==========================================

/**
 * 重建 authors/index.js
 *
 * 计数语义与全量种子保持一致：workCount = 该作者 work→author 关系数（含 works 缺失，但过滤 works 表已软删除项），
 * downloadedCount = 其中命中 completed_works 的数量；hasShard 依据分片文件是否被上面重建（validCount>0）。
 * @private
 */
async function _rebuildAuthorsIndex(baseDir, platform, generatedAt, authorStats) {
    const [authors, relations, completedList] = await Promise.all([
        database.getAll('authors'),
        database.getAll('relations'),
        database.getAll('completed_works')
    ]);
    const completedIds = new Set(completedList.map(c => c.workId));

    // 按作者聚合关系（无 works 对象，只统计 ID 与 completed 命中）
    const relByAuthor = new Map();
    for (const r of relations) {
        if (r.sourceType !== 'work' || r.targetType !== 'author') continue;
        if (!relByAuthor.has(r.targetId)) relByAuthor.set(r.targetId, []);
        relByAuthor.get(r.targetId).push(r.sourceId);
    }

    const sorted = (authors || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const index = [];
    let downloadedAuthors = 0;
    let totalAuthors = 0;
    for (const author of sorted) {
        const workIds = relByAuthor.get(author.uid) || [];
        const downloadedCount = workIds.filter(id => completedIds.has(id)).length;
        const workCount = workIds.length;
        let downloadStatus = 'pending';
        if (downloadedCount > 0) downloadStatus = downloadedCount >= workCount ? 'completed' : 'partial';
        if (downloadedCount > 0) downloadedAuthors++;
        const rec = buildAuthorRecord(author, { downloadStatus, downloadedCount, workCount });
        // hasShard：优先用本次重建结果；否则以分片文件是否存在推断（避免为全表作者探测文件）
        const st = authorStats.get(author.uid);
        rec.hasShard = st ? st.validCount > 0 : await _shardExists(`${baseDir}/authors/${author.uid}.js`);
        totalAuthors++;
        index.push(rec);
    }

    await fileSystem.writeTextFile(`${baseDir}/authors/index.js`, serializeForBrowser(
        { platform, generatedAt, count: index.length, authors: index }, OFFLINE_VARS.authorsIndex));

    return { downloadedAuthors, totalAuthors };
}

/**
 * 判断某分片文件是否存在（读一次即可，失败视为不存在）
 * @private
 */
async function _shardExists(path) {
    try {
        const c = await fileSystem.readTextFile(path);
        return !!(c && c.trim());
    } catch (_) {
        return false;
    }
}

/**
 * 重建 manifest.js + offline-index.js 的计数（基于小对象表统计，语义与种子一致）
 * @private
 */
async function _rebuildManifestAndIndex(baseDir, platform, generatedAt, authorCounts) {
    const [collects, relations, completedList] = await Promise.all([
        database.getAll('collects'),
        database.getAll('relations'),
        database.getAll('completed_works')
    ]);
    const completedIds = new Set(completedList.map(c => c.workId));

    // 点赞：月份 + 下载计数
    const likedRels = relations.filter(r => r.sourceType === 'work' && r.targetType === 'liked_group' && r.targetId === 'liked');
    const monthsSet = new Set();
    let likedDownloaded = 0;
    for (const r of likedRels) {
        monthsSet.add(getMonthKey(r.createdAt));
        if (completedIds.has(r.sourceId)) likedDownloaded++;
    }
    const likedMonths = [...monthsSet].sort((a, b) => {
        if (a === 'unknown') return 1;
        if (b === 'unknown') return -1;
        return b.localeCompare(a);
    });

    // 收藏夹：清单 + 下载计数
    const validCollects = (collects || []).filter(c => !c.isDeleted);
    validCollects.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const relByCollect = new Map();
    for (const r of relations) {
        if (r.sourceType !== 'work' || r.targetType !== 'collect') continue;
        if (!relByCollect.has(r.targetId)) relByCollect.set(r.targetId, []);
        relByCollect.get(r.targetId).push(r.sourceId);
    }
    const collectInfos = [];
    let bookmarkedDownloaded = 0;
    for (const collect of validCollects) {
        const ids = relByCollect.get(collect.collectId) || [];
        const hasDownloaded = ids.some(id => completedIds.has(id));
        if (hasDownloaded) bookmarkedDownloaded++;
        collectInfos.push({
            collectId: collect.collectId,
            collectName: collect.collectName || '',
            workCount: ids.length
        });
    }

    const counts = {
        authors: { downloaded: authorCounts.downloadedAuthors, total: authorCounts.totalAuthors },
        liked: { downloaded: likedDownloaded, total: likedRels.length },
        bookmarked: { downloaded: bookmarkedDownloaded, total: validCollects.length }
    };

    const oldManifest = await _readShard(`${baseDir}/manifest.js`, OFFLINE_VARS.manifest);
    const manifest = {
        platform,
        generatedAt,
        counts,
        likedMonths,
        collects: collectInfos,
        authorsIndex: 'authors/index.js',
        searchIndex: 'search-index.js',
        searchIndexCount: oldManifest?.searchIndexCount || 0
    };
    await fileSystem.writeTextFile(`${baseDir}/manifest.js`, serializeForBrowser(manifest, OFFLINE_VARS.manifest));

    await _updateOfflineIndex(platform, generatedAt, counts);
    return counts;
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
            if (parsed && Array.isArray(parsed.platforms)) platforms = parsed.platforms;
        }
    } catch (_) { /* 读取失败则重建 */ }

    const entry = {
        platform,
        name: CONFIG.PLATFORM_INFO?.[platform]?.name || platform,
        dataPath: getOfflineBaseDir(platform),
        generatedAt,
        counts
    };
    const idx = platforms.findIndex(p => p.platform === platform);
    if (idx >= 0) platforms[idx] = entry;
    else platforms.push(entry);

    await fileSystem.writeTextFile(indexPath, serializeForBrowser({ generatedAt, platforms }, OFFLINE_VARS.index));
}

// ==========================================
// search-index 定点修补（按脏 workId 增/改/删，避免重读全库 works）
// ==========================================

/**
 * @param {Map<string, Array<{kind,key}>>} dirtyWorkBuckets - 脏 workId → 当前归属桶（可能为空数组表示已移出所有桶）
 * @private
 */
async function _patchSearchIndex(baseDir, platform, generatedAt, dirtyWorkBuckets) {
    const idx = await _readShard(`${baseDir}/search-index.js`, OFFLINE_VARS.searchIndex);
    if (!idx || !Array.isArray(idx.entries)) {
        // 尚无搜索索引：交回全量种子生成补齐（本次不阻断列表分片重建）
        return null;
    }
    const byWork = new Map(idx.entries.map(e => [e.workId, e]));

    for (const [workId, buckets] of dirtyWorkBuckets) {
        const work = await database.get('works', workId);
        const stillValid = work && !work.isDeleted && buckets.length > 0;
        if (!stillValid) {
            byWork.delete(workId);
            continue;
        }
        // 维度优先级：点赞 > 收藏 > 作者
        const liked = buckets.find(b => b.kind === 'liked');
        const collect = buckets.find(b => b.kind === 'collect');
        const author = buckets.find(b => b.kind === 'author');
        const src = liked ? `l:${liked.key}` : collect ? `b:${collect.key}` : `a:${author.key}`;
        byWork.set(workId, {
            workId,
            desc: (work.desc || '').slice(0, 120),
            authorNickname: work.author?.nickname || '',
            src
        });
    }

    const entries = [...byWork.values()];
    await fileSystem.writeTextFile(`${baseDir}/search-index.js`, serializeForBrowser(
        { platform, generatedAt, count: entries.length, entries }, OFFLINE_VARS.searchIndex));
    return entries.length;
}

// ==========================================
// 主入口：合并刷写脏清单
// ==========================================

/**
 * 增量刷新离线数据：只重建受影响分片，重算聚合小文件与搜索索引。
 *
 * @param {string} [platform] - 平台标识（默认当前激活平台）
 * @returns {Promise<Object>} { success, shards?, counts?, reason?, error? }
 */
export async function flushOfflineDelta(platform = CONFIG.ACTIVE_PLATFORM) {
    if (_flushing) {
        _again = true;
        return { success: false, reason: 'in_progress' };
    }
    if (!fileSystem.hasDirectoryPermission()) {
        return { success: false, reason: 'no_root_directory' };
    }

    _flushing = true;
    const startTime = Date.now();
    try {
        await fileSystem.initDatabase();
        await _hydrate();

        let shards = 0;
        let rounds = 0;
        do {
            _again = false;
            rounds++;

            const dirtyIds = [..._workIds];
            const recordedBuckets = [..._buckets.values()];
            if (dirtyIds.length === 0 && recordedBuckets.length === 0) break;

            // 先清空内存，处理期间的新的变更会重新累积并在下一轮补跑
            _workIds.clear();
            _buckets.clear();

            const baseDir = getOfflineBaseDir(platform);
            const generatedAt = Date.now();

            // 1. 脏 workId → 当前归属桶；并入登记的曾属桶，得到受影响分片集合
            const dirtyWorkBuckets = new Map();
            const affected = new Map(); // bucketKey -> {kind,key}
            const addBucket = (kind, key) => {
                if (key === undefined || key === null) return;
                affected.set(bucketKey(kind, key), { kind, key });
            };
            for (const id of dirtyIds) {
                const bs = await _bucketsOfWork(id);
                dirtyWorkBuckets.set(id, bs);
                bs.forEach(b => addBucket(b.kind, b.key));
            }
            recordedBuckets.forEach(b => addBucket(b.kind, b.key));

            // 2. 只重建受影响分片
            const authorStats = new Map();
            for (const { kind, key } of affected.values()) {
                if (kind === 'liked') {
                    await _rebuildLikedShard(baseDir, key, platform, generatedAt);
                } else if (kind === 'collect') {
                    await _rebuildCollectShard(baseDir, key, platform, generatedAt);
                } else if (kind === 'author') {
                    const st = await _rebuildAuthorShard(baseDir, key, platform, generatedAt);
                    authorStats.set(key, st);
                }
                shards++;
            }

            // 3. 聚合小文件重算（只读小对象表）
            const authorCounts = await _rebuildAuthorsIndex(baseDir, platform, generatedAt, authorStats);
            const counts = await _rebuildManifestAndIndex(baseDir, platform, generatedAt, authorCounts);

            // 4. search-index 定点修补
            const searchCount = await _patchSearchIndex(baseDir, platform, generatedAt, dirtyWorkBuckets);
            if (searchCount !== null) {
                // 修正 manifest 里的搜索索引条数（_patch 前读到的是旧值）
                const m = await _readShard(`${baseDir}/manifest.js`, OFFLINE_VARS.manifest);
                if (m) {
                    m.searchIndexCount = searchCount;
                    await fileSystem.writeTextFile(`${baseDir}/manifest.js`, serializeForBrowser(m, OFFLINE_VARS.manifest));
                }
            }

            await _persistLedger();
        } while (_again && rounds < 5);

        const duration = Date.now() - startTime;
        logger.info(`♻️ 离线增量刷新完成（平台:${platform}, 重建分片:${shards}, 轮次:${rounds}, 耗时:${duration}ms）`);
        return { success: true, shards, duration };
    } catch (error) {
        logger.error('❌ 离线增量刷新失败:', error?.message || error);
        // 失败不丢脏：回灌本轮待处理项，下次触发重试
        return { success: false, error: error?.message || String(error) };
    } finally {
        _flushing = false;
    }
}

/**
 * 保证离线数据存在且与库同步：
 *   - 目录空 / 无 manifest → 全量种子（唯一一次全量）；
 *   - 否则 → 增量刷新。
 * @param {string} [platform]
 * @returns {Promise<Object>}
 */
export async function ensureOfflineData(platform = CONFIG.ACTIVE_PLATFORM) {
    if (!fileSystem.hasDirectoryPermission()) {
        logger.warn('⚠️ 未设置根目录，跳过离线数据准备');
        return { success: false, reason: 'no_root_directory' };
    }
    const manifestExists = await _shardExists(`${getOfflineBaseDir(platform)}/manifest.js`);
    if (!manifestExists) {
        logger.info('🆕 离线数据目录为空，执行首次全量种子生成');
        return generateOfflineData(platform);
    }
    return flushOfflineDelta(platform);
}

export default { markOfflineDirty, flushOfflineDelta, ensureOfflineData };
