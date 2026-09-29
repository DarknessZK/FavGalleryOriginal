// ==========================================
// 话题标签提取 - 纯逻辑（零依赖，不碰浏览器 / DOM / 数据库）
// 职责：从作品描述 desc 中提取抖音话题（#xxx），去 #、去重、按首次出现顺序返回。
// 背景：话题 100% 可从 desc 派生且只读，按「最小冗余」原则不单独入库；仅在需要处
//       （离线数据生成 offline-record-builder、消费端筛选）提取。设计见 docs/DATABASE_SCHEMA.md 5.7。
// ==========================================

/**
 * 从 desc 提取话题标签（不含前导 #）。
 *
 * 规则：
 * - 话题以半角 `#` 或全角 `＃` 起始，token 为其后到下一个空白 / `#` / `＃` 之前的连续字符
 *   （兼容 "#英文翻唱#女生翻唱" 紧邻、"#翻唱 中间带空格" 等形态）；
 * - token 尾部粘连的常见中英文标点会被裁掉（如 "翻唱。" → "翻唱"），避免出现脏标签；
 * - 去重并保留首次出现顺序；无话题 / 非字符串输入一律返回空数组。
 *
 * @param {string} desc - 作品描述文本
 * @returns {string[]} 话题名列表（不含 #）
 */
export function extractTopics(desc) {
    if (typeof desc !== 'string' || !desc) return [];

    const re = /[＃#]([^\s＃#，。！？、；：,.!?;:]+)/g;
    const trailingPunct = /[～~)）】》》"'“”‘’]+$/;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(desc)) !== null) {
        const token = m[1].replace(trailingPunct, '').trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}

export default { extractTopics };
