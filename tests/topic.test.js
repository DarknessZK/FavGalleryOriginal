// ==========================================
// 话题标签提取 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html
// 覆盖：基本提取 / 全角＃ / 紧邻多话题 / 尾部标点裁剪 / 去重保序 / 脏输入
// 对应「话题标签（从 desc 派生，不存表）」，设计见 docs/DATABASE_SCHEMA.md 5.7
// ==========================================

import { extractTopics } from '../utils/topic.js';

/**
 * 执行全部断言
 * @returns {{title: string, groups: Array<{name: string, cases: Array<{name: string, ok: boolean, expected: string, actual: string}>}>, passed: number, failed: number}}
 */
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
        if (ok) passed++; else failed++;
        current.cases.push({
            name,
            ok,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual)
        });
    };

    // ==========================================
    section('[1] 基本提取');
    // ==========================================
    check('单个话题去 #', extractTopics('好听#英文翻唱'), ['英文翻唱']);
    check('话题在中间，两侧有正文', extractTopics('来一首#翻唱 希望大家喜欢'), ['翻唱']);
    check('【核心】紧邻多话题 "#A#B"', extractTopics('#英文翻唱#女生翻唱 支持一下'), ['英文翻唱', '女生翻唱']);
    check('空格分隔多话题', extractTopics('#教程 #素材 收藏备用'), ['教程', '素材']);
    check('无话题返回空数组', extractTopics('这是一段普通描述，没有任何井号'), []);

    // ==========================================
    section('[2] 全角 ＃ 与形态兼容');
    // ==========================================
    check('全角 ＃ 也识别', extractTopics('＃旅行日记 分享'), ['旅行日记']);
    check('全角/半角混用', extractTopics('#a ＃b'), ['a', 'b']);
    check('话题含数字', extractTopics('#2024年度盘点 来了'), ['2024年度盘点']);
    check('话题含英文大小写原样保留', extractTopics('#Cover Song'), ['Cover']);

    // ==========================================
    section('[3] 尾部标点裁剪');
    // ==========================================
    check('尾部中文句号被裁', extractTopics('好歌#翻唱。'), ['翻唱']);
    check('尾部中文逗号被裁', extractTopics('#教程，收藏'), ['教程']);
    check('尾部右括号被裁', extractTopics('（#话题）'), ['话题']);

    // ==========================================
    section('[4] 去重保序');
    // ==========================================
    check('重复话题只保留首个（保持首次出现顺序）',
        extractTopics('#音乐 #舞蹈 #音乐 # painting'), ['音乐', '舞蹈']);

    // ==========================================
    section('[5] 脏输入归一');
    // ==========================================
    check('空字符串 → 空数组', extractTopics(''), []);
    check('null → 空数组', extractTopics(null), []);
    check('undefined → 空数组', extractTopics(undefined), []);
    check('非字符串（数字）→ 空数组', extractTopics(123), []);
    check('只有 # 号无内容 → 空数组', extractTopics('#  #  ##'), []);
    check('纯 # 开头 token 为井号延续被忽略', extractTopics('###'), []);

    return { title: '话题标签提取（utils/topic.js）', groups, passed, failed };
}
