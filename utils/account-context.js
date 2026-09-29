// ==========================================
// FavGallery - 账号上下文
// 职责：账号维度数据区隔离的纯逻辑规范（可单测） + 内存态账号绑定
// 说明：抖音 uid 是唯一身份键。数据子目录名形如 FavGallery(昵称)[uid]，
//       匹配只看 [uid] 段（昵称改版不改目录，避免账号数据分裂）；
//       Windows 目录名不允许 <>:"/\|?* 与控制字符，昵称段需净化；
//       IndexedDB 库名无字符限制，规范为 FavGallery_<uid>，未绑定账号时用 guest 兜底库。
// ==========================================

/** Windows/Linux 均禁止的目录名字符（含控制字符） */
const FORBIDDEN_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

/** 目录名中昵称段的最大长度（防止长昵称撑爆路径） */
const NICK_MAX_LEN = 24;

/** 账号数据子目录的统一前缀（区分于根目录下的其他杂物） */
export const ACCOUNT_FOLDER_PREFIX = 'FavGallery(';

/** 目录名尾部 [uid] 段的提取模式 */
const UID_IN_FOLDER_PATTERN = /\[(\d+)\]$/;

/** 未绑定账号时的兜底库名（仅允许存全局偏好类设置，不允许业务数据） */
export const GUEST_DB_NAME = 'FavGallery_guest';

/**
 * 净化昵称使其可安全用作 Windows 目录名片段
 * 去除禁止字符与首尾空白，截断到 NICK_MAX_LEN，空值回退为占位符
 * @param {string} nickname - 原始昵称
 * @returns {string} 安全昵称
 */
export function sanitizeFolderNick(nickname) {
    // 顺序：去非法字符 → trim → 去尾部点（Windows 不允许尾点/尾空格）→ 再 trim
    const cleaned = String(nickname || '')
        .replace(FORBIDDEN_FOLDER_CHARS, '')
        .trim()
        .replace(/[.]+$/, '')
        .trim();
    return (cleaned || '未知用户').slice(0, NICK_MAX_LEN);
}

/**
 * 构造账号数据子目录名：FavGallery(昵称)[uid]
 * @param {string} nickname - 账号昵称（原始值，内部净化）
 * @param {string|number} uid - 账号抖音 uid
 * @returns {string} 目录名；uid 无效时返回空串（调用方须拒绝继续）
 */
export function buildAccountFolderName(nickname, uid) {
    const safeUid = String(uid || '').trim();
    if (!/^\d+$/.test(safeUid)) {
        return '';
    }
    return `${ACCOUNT_FOLDER_PREFIX}${sanitizeFolderNick(nickname)})[${safeUid}]`;
}

/**
 * 从目录名提取 [uid] 段
 * @param {string} name - 目录名
 * @returns {string|null} uid，不匹配返回 null
 */
export function extractUidFromFolderName(name) {
    const match = UID_IN_FOLDER_PATTERN.exec(String(name || ''));
    return match ? match[1] : null;
}

/**
 * 在目录名列表中查找属于指定账号的数据子目录
 * ✅ 只按 [uid] 匹配：昵称变了仍复用旧目录（旧目录名保留历史昵称，不重命名）
 * @param {Array<string>} names - 根目录下的子目录名列表
 * @param {string|number} uid - 当前账号 uid
 * @returns {string|null} 命中的目录名
 */
export function findAccountFolderName(names, uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return null;
    for (const name of names || []) {
        if (extractUidFromFolderName(name) === safeUid) {
            return name;
        }
    }
    return null;
}

/**
 * 构造账号维度的 IndexedDB 库名
 * @param {string|number|null} uid - 账号 uid；空值返回 guest 兜底库
 * @returns {string} 库名
 */
export function buildDbName(uid) {
    const safeUid = String(uid || '').trim();
    return safeUid ? `FavGallery_${safeUid}` : GUEST_DB_NAME;
}

// ==========================================
// 内存态账号绑定（Content 上下文为权威；每个页面进程各自一份）
// ==========================================

/** @type {{uid:string, nickname:string, folderName:string, boundAt:number}|null} */
let account = null;

/**
 * 绑定当前账号数据区
 * @param {Object} acc - { uid, nickname, folderName }
 * @returns {boolean} 是否绑定成功（uid 无效则失败且不改变现有绑定）
 */
export function setAccount(acc) {
    const safeUid = String(acc?.uid || '').trim();
    if (!/^\d+$/.test(safeUid)) {
        return false;
    }
    account = {
        uid: safeUid,
        nickname: acc?.nickname || '',
        folderName: acc?.folderName || buildAccountFolderName(acc?.nickname, safeUid),
        boundAt: Date.now()
    };
    return true;
}

/**
 * 获取当前绑定的账号（未绑定返回 null）
 * @returns {Object|null} 账号信息
 */
export function getAccount() {
    return account;
}

/** 清除账号绑定（切回未选文件夹状态时使用） */
export function clearAccount() {
    account = null;
}

/**
 * 账号切换检查：对照当前登录身份与已绑定数据区
 * ✅ 三态口径与关注校验一致：取不到当前身份（unknown）时不拦截、不改判
 * @param {Object|null} currentUserInfo - 页面直取的当前登录用户信息（可为 null）
 * @returns {{ok:boolean, reason:string, bound?:Object, current?:Object}} 检查结论
 */
export function checkAccountSwitch(currentUserInfo) {
    if (!account) {
        return { ok: false, reason: 'not_bound' };
    }
    const currentUid = String(currentUserInfo?.uid || '').trim();
    if (!currentUid) {
        // 身份未知：无法证实也无法证伪，放行
        return { ok: true, reason: 'unknown' };
    }
    if (currentUid !== account.uid) {
        return { ok: false, reason: 'switched', bound: account, current: currentUserInfo };
    }
    return { ok: true, reason: 'match' };
}
