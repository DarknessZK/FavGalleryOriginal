// ==========================================
// FavGallery - 离线浏览页静态壳生成器
// 职责：把扩展内的 HTML/CSS/JS 源文件拷贝到用户根目录，供 file:// 双击打开
// 说明：运行于扩展侧（Content Script main world，无 chrome.runtime 访问）；
//       通过 fetch(chrome-extension://<id>/…) 读取已声明于 web_accessible_resources
//       的源文件，再经 fileSystem 写入用户目录。
//       设计详见 docs/OFFLINE_COLLECTION_VIEWER.md（流程 A / 十三·源文件→产物映射）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { fileSystem } from '../storage/file-system.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('OfflineShellGenerator');

const viewerDir = CONFIG.FILE_SYSTEM.OFFLINE_VIEWER_DIR;

/**
 * 源文件（扩展内相对路径）→ 目标（用户根目录相对路径）映射
 * 源文件均须声明于 manifest.json 的 web_accessible_resources
 */
const SHELL_FILES = [
    { src: 'ui/html/my-collection.html', dest: CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML },
    { src: 'ui/css/my-collection.css', dest: `${viewerDir}/my-collection.css` },
    { src: 'ui/local/core.js', dest: `${viewerDir}/core.js` },
    { src: 'ui/local/features.js', dest: `${viewerDir}/features.js` },
    { src: 'ui/local/index.js', dest: `${viewerDir}/index.js` }
];

/**
 * 读取扩展内资源文本
 * @param {string} extensionOrigin - 形如 chrome-extension://<id>
 * @param {string} relPath - 扩展内相对路径
 * @returns {Promise<string>} 文件文本内容
 * @private
 */
async function _readExtensionFile(extensionOrigin, relPath) {
    const url = `${extensionOrigin}/${relPath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`读取扩展资源失败(${relPath}): HTTP ${resp.status}`);
    }
    return await resp.text();
}

/**
 * 生成离线浏览页静态壳（FavGallery.html + resources/offline-viewer/*）
 * 每次调用全量覆盖，保证用户拿到与当前扩展版本一致的壳。
 *
 * @param {string} extensionOrigin - 扩展源（chrome-extension://<id>），由 main world 传入
 * @returns {Promise<Object>} { success, count?, reason?, error? }
 */
export async function generateStaticShell(extensionOrigin) {
    if (!extensionOrigin) {
        logger.warn('⚠️ 缺少扩展源(extensionOrigin)，跳过静态壳生成');
        return { success: false, reason: 'no_extension_origin' };
    }
    if (!fileSystem.hasDirectoryPermission()) {
        logger.warn('⚠️ 未设置根目录，跳过静态壳生成');
        return { success: false, reason: 'no_root_directory' };
    }

    try {
        let count = 0;
        // 资源版本号：给入口 HTML 引用的静态壳资源（CSS/JS）追加 ?v=，
        // 使每次重新生成后 file:// 页面刷新必然重新拉取，规避浏览器对本地 JS/CSS 的旧缓存
        // （否则会出现“HTML 已更新但 core/features/index.js 仍跑旧缓存”的错位）
        const shellVer = Date.now();
        for (const f of SHELL_FILES) {
            let content = await _readExtensionFile(extensionOrigin, f.src);
            if (f.src.endsWith('.html')) {
                content = content.replace(
                    /(offline-viewer\/[^"'?]+?\.(?:js|css))/g,
                    `$1?v=${shellVer}`
                );
            }
            await fileSystem.writeTextFile(f.dest, content);
            count++;
        }
        logger.info(`✅ 离线静态壳已生成: ${count} 个文件 → ${CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML}（资源版本 v=${shellVer}）`);
        return { success: true, count };
    } catch (error) {
        logger.error('❌ 离线静态壳生成失败:', error);
        return { success: false, error: error?.message || String(error) };
    }
}

export default { generateStaticShell, SHELL_FILES };
