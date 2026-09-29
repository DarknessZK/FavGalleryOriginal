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

/**
 * ✅ 通用确认对话框（自包含内联样式，无外部 CSS/HTML 依赖）
 * 用途：需要用户明确确认再执行的操作（如“校验补全”前的说明框）
 * @param {Object} options
 * @param {string} [options.title='请确认'] - 标题
 * @param {string} [options.message=''] - 正文（支持 \n 换行，按纯文本渲染防注入）
 * @param {string} [options.okText='确定'] - 确认按钮文本
 * @param {string} [options.cancelText='取消'] - 取消按钮文本
 * @returns {Promise<boolean>} 确定→true，取消/关闭/Esc→false
 */
export function showConfirmModal({ title = '请确认', message = '', okText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') { resolve(false); return; }

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:100000;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:8px;max-width:80%;width:320px;padding:18px 20px;box-shadow:0 8px 30px rgba(0,0,0,0.2);font-size:13px;color:#333;';

        const titleEl = document.createElement('div');
        titleEl.textContent = title;
        titleEl.style.cssText = 'font-size:15px;font-weight:bold;margin-bottom:10px;';

        const msgEl = document.createElement('div');
        msgEl.style.cssText = 'line-height:1.75;margin-bottom:16px;white-space:normal;';
        String(message).split('\n').forEach((line, i) => {
            if (i > 0) msgEl.appendChild(document.createElement('br'));
            msgEl.appendChild(document.createTextNode(line));
        });

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = cancelText;
        cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid #d9d9d9;background:#fff;color:#666;border-radius:4px;cursor:pointer;font-size:13px;';
        const okBtn = document.createElement('button');
        okBtn.textContent = okText;
        okBtn.style.cssText = 'padding:6px 16px;border:1px solid #1890ff;background:#1890ff;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;';

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            resolve(result);
        };
        cancelBtn.addEventListener('click', () => close(false));
        okBtn.addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        const onKey = (e) => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
        document.addEventListener('keydown', onKey);

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        box.appendChild(titleEl);
        box.appendChild(msgEl);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        okBtn.focus();
    });
}
