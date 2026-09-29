// ==========================================
// 关注取证与决策 / 关系分组 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html
// 覆盖：follow_status 三态归一 / 响应路径解析 / 决策矩阵安全侧 / 关系分组不错位 / 已取关操作态口径
// ==========================================

import {
    FOLLOW_STATE,
    normalizeFollowStatus,
    parseFollowState,
    resolveAuthorDownloadDecision
} from '../utils/follow-verification.js';
import {
    buildRelationGroupKey,
    groupRelationsByTarget
} from '../utils/relation-group.js';
import { resolveAuthorAction, isAuthorSelectable } from '../utils/author-completion.js';

export function run() {
    const groups = [];
    let current = null;
    let passed = 0;
    let failed = 0;

    const section = (name) => {
        current = { name, cases: [] };
        groups.push(current);
    };

    const check = (name, actual, expected) => {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        if (ok) {
            passed++;
        } else {
            failed++;
        }
        current.cases.push({
            name,
            ok,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual)
        });
    };

    // ==========================================
    section('[1] normalizeFollowStatus 三态归一');
    // ==========================================
    check('数字 0 → 已取关', normalizeFollowStatus(0), FOLLOW_STATE.UNFOLLOWED);
    check('字符串 "0" → 已取关', normalizeFollowStatus('0'), FOLLOW_STATE.UNFOLLOWED);
    check('数字 1 → 关注中', normalizeFollowStatus(1), FOLLOW_STATE.FOLLOWING);
    check('字符串 "1" → 关注中', normalizeFollowStatus('1'), FOLLOW_STATE.FOLLOWING);
    check('【安全侧】未知枚举 2 → unknown', normalizeFollowStatus(2), FOLLOW_STATE.UNKNOWN);
    check('未知枚举 -1 → unknown', normalizeFollowStatus(-1), FOLLOW_STATE.UNKNOWN);
    check('缺失 undefined → unknown', normalizeFollowStatus(undefined), FOLLOW_STATE.UNKNOWN);
    check('缺失 null → unknown', normalizeFollowStatus(null), FOLLOW_STATE.UNKNOWN);
    check('空字符串 → unknown（绝不因缺字段误判已取关）', normalizeFollowStatus(''), FOLLOW_STATE.UNKNOWN);
    check('布尔 true → unknown（不做宽松真值转换）', normalizeFollowStatus(true), FOLLOW_STATE.UNKNOWN);

    // ==========================================
    section('[2] parseFollowState 响应路径解析');
    // ==========================================
    check('user.follow_status=1（实测已关注作者形态）',
        parseFollowState({ user: { follow_status: 1, following_count: 163, follower_count: 1168 } }),
        FOLLOW_STATE.FOLLOWING);
    check('user.follow_status=0（实测未关注作者形态）',
        parseFollowState({ user: { follow_status: 0, following_count: 985, follower_count: 171382 } }),
        FOLLOW_STATE.UNFOLLOWED);
    check('follow_info.follow_status 备选路径',
        parseFollowState({ follow_info: { follow_status: 1 } }),
        FOLLOW_STATE.FOLLOWING);
    check('顶层 follow_status 备选路径',
        parseFollowState({ follow_status: 0 }),
        FOLLOW_STATE.UNFOLLOWED);
    check('响应无任何关注字段 → unknown',
        parseFollowState({ user: { nickname: 'x' } }),
        FOLLOW_STATE.UNKNOWN);
    check('payload 为 null → unknown', parseFollowState(null), FOLLOW_STATE.UNKNOWN);
    check('payload 非对象 → unknown', parseFollowState('error'), FOLLOW_STATE.UNKNOWN);
    check('字段值为 null 视同缺失（继续找下一路径）',
        parseFollowState({ user: { follow_status: null }, follow_status: 0 }),
        FOLLOW_STATE.UNFOLLOWED);

    // ==========================================
    section('[3] resolveAuthorDownloadDecision 决策矩阵（安全侧）');
    // ==========================================

    const unf = resolveAuthorDownloadDecision(FOLLOW_STATE.UNFOLLOWED);
    check('已取关 → 跳过下载', unf.shouldSkip, true);
    check('已取关 → 打软删除标记', unf.shouldMarkDeleted, true);

    const fol = resolveAuthorDownloadDecision(FOLLOW_STATE.FOLLOWING);
    check('关注中 → 照常下载', fol.shouldSkip, false);
    check('关注中 → 不标删', fol.shouldMarkDeleted, false);

    const unk = resolveAuthorDownloadDecision(FOLLOW_STATE.UNKNOWN);
    check('【核心】未知 → 照常下载（断网/接口异常绝不误标删）', unk.shouldSkip, false);
    check('【核心】未知 → 绝不打软删除标记', unk.shouldMarkDeleted, false);
    check('未知 → 不撤销既有结论（shouldRestore 恒 false）', unk.shouldRestore, false);
    check('非法入参按未知决策', resolveAuthorDownloadDecision('nonsense').shouldMarkDeleted, false);

    // ==========================================
    section('[4] groupRelationsByTarget 分组不错位（split 反解缺陷回归）');
    // ==========================================

    // 旧缺陷场景：targetId 自身含下划线（liked_group / author_group / collect_group），split('_') 反解错位
    const items = [
        { id: 1, sourceType: 'work', sourceId: 'w1', targetType: 'liked', targetId: 'liked_group' },
        { id: 2, sourceType: 'work', sourceId: 'w2', targetType: 'liked', targetId: 'liked_group' },
        { id: 3, sourceType: 'work', sourceId: 'w3', targetType: 'author', targetId: 'author_group' },
        { id: 4, sourceType: 'work', sourceId: 'w4', targetType: 'collect', targetId: 'collect_group' },
        { id: 5, sourceType: 'work', sourceId: 'w1', targetType: 'author', targetId: 'MS4wLjABAAAA_x7' },
        { id: 6, sourceType: 'work', sourceId: 'w2', targetType: 'author', targetId: 'MS4wLjABAAAA_x7' }
    ];
    const groupsMap = groupRelationsByTarget(items);
    check('分组数正确（4 个目标）', groupsMap.size, 4);

    const likedGroup = [...groupsMap.values()].find(g => g.targetType === 'liked');
    check('liked → liked_group 组完整（2 条）', likedGroup && likedGroup.items.length, 2);
    check('liked 组 targetId 未被下划线截断', likedGroup && likedGroup.targetId, 'liked_group');

    const authorGroupGroup = [...groupsMap.values()].find(g => g.targetId === 'author_group');
    check('author → author_group 独立成组（不与 work 目标混组）', authorGroupGroup && authorGroupGroup.targetType, 'author');

    const uidGroup = [...groupsMap.values()].find(g => g.targetId === 'MS4wLjABAAAA_x7');
    check('含下划线的 uid 分组正确（2 条）', uidGroup && uidGroup.items.length, 2);
    check('同 targetId 不同类型不误合并（author:uid 与 collect:uid 分开）',
        buildRelationGroupKey({ targetType: 'author', targetId: 'x' }) === buildRelationGroupKey({ targetType: 'collect', targetId: 'x' }),
        false);
    check('空输入返回空 Map', groupRelationsByTarget([]).size, 0);

    // ==========================================
    section('[5] 已取关操作态（author-completion 消费侧口径）');
    // ==========================================

    const deleted = resolveAuthorAction({ knownWorkCount: 9, downloadedCount: 5, platformWorkCount: 8, isDeleted: true });
    check('isDeleted → unfollowed 态优先于计数判定', deleted.state, 'unfollowed');
    check('isDeleted → 不可点', deleted.clickable, false);
    check('isDeleted → 不可勾选', deleted.selectable, false);
    check('isDeleted → 文案已取关', deleted.text, '🚫 已取关');
    check('isDeleted → 带 empty 类（enableAllDownloadButtons 会跳过）', deleted.className.includes('empty'), true);
    check('isDeleted=false 不影响原有判定',
        resolveAuthorAction({ knownWorkCount: 9, downloadedCount: 5, platformWorkCount: 8, isDeleted: false }).state,
        'partial');
    check('批量选择与卡片同口径（isDeleted 作者不可选）',
        isAuthorSelectable({ workCount: 9, downloadedCount: 5, platformWorkCount: 8, isDeleted: true }),
        false);
    check('未标删作者仍可选',
        isAuthorSelectable({ workCount: 9, downloadedCount: 5, platformWorkCount: 8 }),
        true);

    return { title: '关注取证与决策 / 关系分组（utils/follow-verification.js + utils/relation-group.js）', groups, passed, failed };
}

