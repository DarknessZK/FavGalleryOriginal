// ==========================================
// UI 辅助工具函数
// 功能：提供 HTML 转义、数字格式化、UI 日志等界面相关工具
// ==========================================

/**
 * HTML 转义（防止 XSS 攻击）
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
