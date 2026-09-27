// ==========================================
// FavGallery - 界面配置子界面
// 职责：Sidebar 侧可视化读写 .FavGallery/config.json（文件操作在 Content Script 侧，
//      本模块通过 GET_USER_CONFIG / SAVE_USER_CONFIG 消息通道代理）
// 交互：入口控制——点「⚙️ 配置」（存储位置标题行右侧）先校验已选文件夹（未选悬浮提示拦截），
//      通过后子界面替换列表区域展示，重复点击入口或点「取消」返回原界面，保存成功后自动返回
// 单位约定：面板用人类友好单位（分钟/秒），保存时换算回毫秒
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { reportError } from '../utils/error-boundary.js';

const logger = createLogger('ConfigPanel');

/**
 * 字段映射表：config.json 路径 ↔ 表单控件
 * div：落盘毫秒 → 面板显示单位的换算除数（缺省不换算）
 * min/max：前端校验范围（含边界）
 */
const FIELD_SPECS = [
    { path: 'listMaxCount.liked', el: 'cfgLikedMax', type: 'int', min: 1, max: 10000 },
    { path: 'listMaxCount.bookmarked', el: 'cfgBookmarkedMax', type: 'int', min: 1, max: 10000 },
    { path: 'listMaxCount.following', el: 'cfgFollowingMax', type: 'int', min: 1, max: 10000 },
    { path: 'listMaxCount.collects', el: 'cfgCollectsMax', type: 'int', min: 1, max: 10000 },
    { path: 'listMaxCount.authorWorks', el: 'cfgAuthorWorksMax', type: 'int', min: 1, max: 10000 },
    { path: 'backup.enabled', el: 'cfgBackupEnabled', type: 'bool' },
    { path: 'backup.interval', el: 'cfgBackupInterval', type: 'int', min: 1, div: 60000 },
    { path: 'backup.listBackup.enabled', el: 'cfgListBackupEnabled', type: 'bool' },
    { path: 'backup.listBackup.batchInterval', el: 'cfgListBatchInterval', type: 'int', min: 1 },
    { path: 'backup.downloadBackup.enabled', el: 'cfgDlBackupEnabled', type: 'bool' },
    { path: 'backup.downloadBackup.timeThreshold', el: 'cfgDlTimeThreshold', type: 'int', min: 1, div: 60000 },
    { path: 'backup.downloadBackup.countThreshold', el: 'cfgDlCountThreshold', type: 'int', min: 1 },
    { path: 'backup.downloadBackup.immediateBackup.enabled', el: 'cfgImmediateBackupEnabled', type: 'bool' },
    { path: 'backup.downloadBackup.immediateBackup.delay', el: 'cfgImmediateBackupDelay', type: 'int', min: 1, div: 1000 }
];

/** 按 'a.b.c' 路径读取 */
function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 按 'a.b.c' 路径写入（自动建中间对象） */
function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
}

class ConfigPanel {
    /**
     * @param {App} app - 侧边栏应用实例
     */
    constructor(app) {
        this.app = app;
        this.current = null;   // 最近一次加载/保存成功的配置
        this.defaults = null;  // Content 侧回传的默认值（供「恢复默认」回填）
        this.opened = false;   // 配置子界面是否展开
        this.saving = false;   // ✅ 防重复提交：保存请求在途时忽略再次点击
        this._toastTimer = null;
    }

    /**
     * 绑定子界面事件（入口切换 / 取消 / 保存 / 恢复默认）
     */
    init() {
        const entry = document.getElementById('openConfigView');
        if (entry) {
            entry.addEventListener('click', () => this.toggle());
        }

        const cancelBtn = document.getElementById('configCancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.close());
        }

        const saveBtn = document.getElementById('configSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._save());
        }

        const defaultsBtn = document.getElementById('configDefaultsBtn');
        if (defaultsBtn) {
            defaultsBtn.addEventListener('click', () => {
                if (this.defaults) {
                    this._fillForm(this.defaults);
                    logToUI('info', '⚙️ 已回填默认值（未保存，点「保存」才写入）');
                } else {
                    this._showToast('配置尚未加载完成，请稍候');
                }
            });
        }

        logger.info('✅ 配置面板已初始化');
    }

    /**
     * ✅ 入口重复点击：在配置子界面与原界面间切换
     */
    toggle() {
        if (this.opened) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * ✅ 入口控制：未选文件夹时悬浮提示拦截，不进入子界面；
     * 通过后隐藏列表区域、展示配置子界面并拉取最新配置
     */
    open() {
        if (!this.app.folderSelected) {
            this._showToast('❌ 请先选择文件夹');
            return;
        }

        this._setView(true);

        // 入口已保证文件夹就绪，控件始终可用，无需管理禁用态
        this._showHint('⏳ 正在加载配置...', false);
        this.requestConfig();
    }

    /**
     * 返回主界面：隐藏子界面、恢复列表区域
     */
    close() {
        this._setView(false);
    }

    /**
     * 切换两个视图的显隐，并同步入口箭头方向（▶/▼，保持原折叠面板观感）
     */
    _setView(open) {
        this.opened = open;
        const listSection = document.getElementById('listSection');
        const view = document.getElementById('configView');
        const arrow = document.getElementById('configEntryArrow');
        if (listSection) listSection.style.display = open ? 'none' : '';
        if (view) view.style.display = open ? 'flex' : 'none';
        if (arrow) arrow.textContent = open ? '▼' : '▶';
    }

    /**
     * 向 Content Script 请求当前配置与默认值
     */
    requestConfig() {
        window.parent.postMessage({ source: 'sidebar', type: 'GET_USER_CONFIG' }, '*');
    }

    /**
     * 处理 USER_CONFIG_LOADED
     */
    handleLoaded(payload) {
        if (!payload || !payload.success) {
            // 入口已校验文件夹，此处为通道异常兜底提示（控件保持可用）
            this._showHint(`⚠️ ${payload?.error || '配置加载失败'}`, true);
            return;
        }

        this.current = payload.config;
        this.defaults = payload.defaults;
        this._fillForm(payload.config);
        this._showHint(`✅ 已加载配置（v${payload.config?.version ?? '?'}），保存后立即生效`, false);
    }

    /**
     * 处理 SAVE_USER_CONFIG_RESULT：成功提示后返回主界面
     */
    handleSaveResult(payload) {
        this.saving = false;
        const saveBtn = document.getElementById('configSaveBtn');
        if (saveBtn) saveBtn.textContent = '💾 保存';

        if (payload && payload.success) {
            this.current = payload.config;
            this._fillForm(payload.config);
            logToUI('success', '⚙️ 用户配置已保存并生效');
            this._showToast('✅ 配置已保存并生效');
            // 稍作停留让 toast 可见，再返回主界面恢复列表区域
            setTimeout(() => this.close(), 600);
        } else {
            const err = payload?.error || '未知错误';
            this._showHint(`❌ 保存失败：${err}`, true);
            // 复用错误边界：红条 + 日志
            reportError(new Error(`保存用户配置失败: ${err}`), 'ConfigPanel');
        }
    }

    /**
     * 表单校验 + 收集（人类单位换算回毫秒）
     * @returns {Object|null} 合法则返回配置对象，非法返回 null 并标红
     */
    _collectForm() {
        let valid = true;
        const config = {};

        for (const spec of FIELD_SPECS) {
            const el = document.getElementById(spec.el);
            if (!el) continue;
            el.classList.remove('cfg-invalid');

            if (spec.type === 'bool') {
                setPath(config, spec.path, el.checked);
                continue;
            }

            const raw = el.value.trim();
            const num = Number(raw);
            const ok = raw !== '' && Number.isInteger(num) && num >= spec.min && num <= (spec.max ?? Infinity);
            if (!ok) {
                el.classList.add('cfg-invalid');
                valid = false;
                continue;
            }
            setPath(config, spec.path, num * (spec.div || 1));
        }

        if (!valid) {
            logToUI('error', '⚙️ 存在非法输入（红框标记），已拒绝保存');
        }
        return valid ? config : null;
    }

    /**
     * 用配置对象回填表单（毫秒换算回人类单位）
     */
    _fillForm(config) {
        for (const spec of FIELD_SPECS) {
            const el = document.getElementById(spec.el);
            if (!el) continue;
            const value = getPath(config, spec.path);

            if (spec.type === 'bool') {
                el.checked = value === true;
            } else if (typeof value === 'number') {
                el.value = String(Math.round(value / (spec.div || 1)));
            } else {
                el.value = '';
            }
            el.classList.remove('cfg-invalid');
        }
    }

    /**
     * 提交保存（防重复：在途时忽略再次点击）
     */
    _save() {
        if (this.saving) return;
        const config = this._collectForm();
        if (!config) return;

        this.saving = true;
        const saveBtn = document.getElementById('configSaveBtn');
        if (saveBtn) saveBtn.textContent = '⏳ 保存中...';

        window.parent.postMessage({
            source: 'sidebar',
            type: 'SAVE_USER_CONFIG',
            config
        }, '*');
        logToUI('info', '⚙️ 已提交配置保存请求');
    }

    /**
     * 面板顶部提示条
     */
    _showHint(text, isError) {
        const hint = document.getElementById('configPanelHint');
        if (!hint) return;
        hint.textContent = text;
        hint.style.background = isError ? '#fff2f0' : '#f6ffed';
        hint.style.borderLeft = isError ? '3px solid #ffccc7' : '3px solid #b7eb8f';
        hint.style.color = isError ? '#cf1322' : '#389e0d';
    }

    /**
     * 全局悬浮提示（fixed 浮层，不受容器裁剪，约 2 秒自动消失）
     */
    _showToast(text) {
        let toast = document.getElementById('cfgToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'cfgToast';
            toast.className = 'cfg-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.classList.add('visible');

        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
    }
}

export { ConfigPanel };
