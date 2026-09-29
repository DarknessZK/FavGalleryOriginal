// ==========================================
// FavGallery 逻辑测试台 - 第 11 步：账号维度数据区隔离
// 覆盖：目录名规范（Windows 非法字符净化 / [uid] 匹配）、库名规范、
//       账号绑定状态机与切号三态判定（unknown 放行口径与关注校验一致）
// ==========================================

import {
    sanitizeFolderNick,
    buildAccountFolderName,
    extractUidFromFolderName,
    findAccountFolderName,
    buildDbName,
    setAccount,
    getAccount,
    clearAccount,
    checkAccountSwitch,
    GUEST_DB_NAME
} from '../utils/account-context.js';

export function run() {
    const groups = [];

    const group = (name) => {
        const g = { name, cases: [] };
        groups.push(g);
        return (caseName, actual, expected) => {
            const ok = JSON.stringify(actual) === JSON.stringify(expected);
            g.cases.push({ ok, name: caseName, expected, actual });
        };
    };

    // ---------- [1] 昵称净化（Windows 目录安全） ----------
    const t1 = group('sanitizeFolderNick：目录名安全化');
    t1('去除全部非法字符', sanitizeFolderNick('a<b>c:d"e/f\\\\g|h?i*j'), 'abcdefghij');
    t1('保留中文括号与emoji', sanitizeFolderNick('拥抱自然🌿（热爱生活）'), '拥抱自然🌿（热爱生活）');
    t1('去尾部点与空白', sanitizeFolderNick('  测试用户.  '), '测试用户');
    t1('空值回退占位符', sanitizeFolderNick(''), '未知用户');
    t1('null 回退占位符', sanitizeFolderNick(null), '未知用户');
    t1('超长昵称截断24', sanitizeFolderNick('一'.repeat(40)).length, 24);
    t1('控制字符被移除', sanitizeFolderNick('名称\u0001\u001F后'), '名称后');

    // ---------- [2] 目录名构造 ----------
    const t2 = group('buildAccountFolderName：FavGallery(昵称)[uid]');
    t2('正常构造', buildAccountFolderName('测试号', '7623978373513921585'), 'FavGallery(测试号)[7623978373513921585]');
    t2('数字型 uid 可绑定', buildAccountFolderName('x', 3208789093003316), 'FavGallery(x)[3208789093003316]');
    t2('非法字符昵称净化', buildAccountFolderName('a/b:c', '123'), 'FavGallery(abc)[123]');
    t2('非数字 uid 返回空串', buildAccountFolderName('x', 'abc*'), '');
    t2('空 uid 返回空串', buildAccountFolderName('x', ''), '');
    t2('null uid 返回空串', buildAccountFolderName('x', null), '');

    // ---------- [3] 目录名识别与匹配 ----------
    const t3 = group('extractUid / findAccountFolderName：只按 [uid] 认区');
    t3('提取 uid', extractUidFromFolderName('FavGallery(昵称)[7623978373513921585]'), '7623978373513921585');
    t3('普通目录不误判', extractUidFromFolderName('.FavGallery'), null);
    t3('任意尾部[数字]都宽松识别', extractUidFromFolderName('备份[123]'), '123');
    t3('末尾数字无方括号不误判', extractUidFromFolderName('抖音2024'), null);
    t3('昵称改版仍命中旧目录', findAccountFolderName(
        ['FavGallery(旧昵称)[100]', 'README.md'], '100'), 'FavGallery(旧昵称)[100]');
    t3('多账号目录取对应', findAccountFolderName(
        ['FavGallery(A)[100]', 'FavGallery(B)[200]'], '200'), 'FavGallery(B)[200]');
    t3('未命中返回 null', findAccountFolderName(['FavGallery(A)[100]'], '999'), null);
    t3('空列表返回 null', findAccountFolderName([], '100'), null);
    t3('空 uid 返回 null', findAccountFolderName(['FavGallery(A)[100]'], ''), null);

    // ---------- [4] 库名规范 ----------
    const t4 = group('buildDbName：FavGallery_<uid> / guest 兜底');
    t4('绑定账号库名', buildDbName('7623978373513921585'), 'FavGallery_7623978373513921585');
    t4('数字型 uid', buildDbName(3208789093003316), 'FavGallery_3208789093003316');
    t4('空值回落 guest', buildDbName(null), GUEST_DB_NAME);
    t4('空串回落 guest', buildDbName('  '), GUEST_DB_NAME);

    // ---------- [5] 绑定状态机与切号判定 ----------
    const t5 = group('setAccount / checkAccountSwitch：三态安全侧');
    clearAccount();
    t5('未绑定时 getAccount 为 null', getAccount(), null);
    t5('未绑定时判定 not_bound', checkAccountSwitch({ uid: '100', nickname: 'A' }).reason, 'not_bound');
    t5('合法 uid 绑定成功', setAccount({ uid: '100', nickname: 'A' }), true);
    t5('绑定后 folderName 自动补齐', getAccount().folderName, 'FavGallery(A)[100]');
    t5('非法 uid 拒绝且保留旧绑定', setAccount({ uid: 'x*y', nickname: 'B' }), false);
    t5('旧绑定未被覆盖', getAccount().uid, '100');
    t5('身份一致放行 match', checkAccountSwitch({ uid: '100', nickname: 'A' }).ok, true);
    t5('身份未知放行 unknown', checkAccountSwitch(null).ok, true);
    t5('确证切号阻断 switched', checkAccountSwitch({ uid: '200', nickname: 'B' }).reason, 'switched');
    t5('切号结论携带双方信息', checkAccountSwitch({ uid: '200', nickname: 'B' }).current.uid, '200');
    clearAccount();
    t5('clearAccount 后回到未绑定', getAccount(), null);

    // ---------- 汇总 ----------
    let passed = 0;
    let failed = 0;
    for (const g of groups) {
        for (const c of g.cases) {
            c.ok ? passed++ : failed++;
        }
    }
    return { passed, failed, groups };
}
