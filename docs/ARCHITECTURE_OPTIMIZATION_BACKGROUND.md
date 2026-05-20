# 架构优化方案：混合架构（Background + Content Script）

> **状态**: 📋 规划中（后期需求）  
> **优先级**: P2（中等优先级）  
> **预计实施时间**: 当前项目稳定后  
> **影响范围**: 核心架构重构

---

## 1. 背景与动机

### 1.1 当前架构的问题

**现状**：所有数据获取逻辑都在 Content Script 中执行

```
Sidebar (UI) → Content Script (数据获取 + API调用 + 数据处理) → 抖音服务器
```

**问题**：
1. ❌ **职责混乱**：Content Script 既做页面注入，又做后端逻辑
2. ❌ **生命周期受限**：页面刷新后 Content Script 销毁，状态丢失
3. ❌ **无法跨标签页共享**：多标签页下载时状态不统一
4. ❌ **不符合最佳实践**：浏览器扩展推荐将复杂逻辑放在 Background

### 1.2 为什么不能直接移到 Background？

**技术限制**：抖音 API 需要用户登录 Cookie

```javascript
// 抖音 API 调用需要携带 Cookie
const response = await fetch(url, {
    credentials: 'include',  // ← 必须携带 Cookie
    headers: this._buildRequestHeaders()
});
```

- **Content Script**：✅ 运行在抖音页面上下文中，自动携带 Cookie
- **Background**：❌ 无法直接访问 HttpOnly Cookie，API 调用会失败（401）

---

## 2. 方案B：混合架构设计

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar (UI 层)                                         │
│  - 只负责显示和用户交互                                    │
│  - 发送意图消息到 Background                               │
└──────────────┬──────────────────────────────────────────┘
               │ chrome.runtime.sendMessage
               ▼
┌─────────────────────────────────────────────────────────┐
│  Background (协调层 / 真正的后端)                          │
│  ├─ DataCoordinator (数据协调器)                          │
│  │   ├─ 接收 Sidebar 请求                                 │
│  │   ├─ 管理全局状态（下载队列、进度等）                     │
│  │   ├─ 转发请求到 Content Script                         │
│  │   └─ 处理后返回结果给 Sidebar                           │
│  ├─ DownloadManager (下载管理器)                          │
│  │   ├─ 管理批量下载任务                                   │
│  │   ├─ 断点续传逻辑                                       │
│  │   └─ 并发控制                                          │
│  └─ StateManager (状态管理器)                             │
│      ├─ IndexedDB 连接池                                  │
│      ├─ 缓存管理                                          │
│      └─ 跨标签页状态同步                                   │
└──────────────┬──────────────────────────────────────────┘
               │ chrome.tabs.sendMessage
               ▼
┌─────────────────────────────────────────────────────────┐
│  Content Script (代理层 / 页面适配器)                      │
│  ├─ APIProxy (API 代理)                                  │
│  │   ├─ 调用抖音 API（携带 Cookie）                        │
│  │   ├─ 解析响应数据                                       │
│  │   └─ 返回原始数据给 Background                          │
│  └─ DOMHelper (DOM 辅助)                                 │
│      ├─ 提取页面信息（用户信息、WebID 等）                  │
│      └─ 注入 UI 元素（可选）                               │
└──────────────┬──────────────────────────────────────────┘
               │ fetch() with cookies
               ▼
┌─────────────────────────────────────────────────────────┐
│  抖音服务器                                                │
└─────────────────────────────────────────────────────────┘
```

### 2.2 职责划分

| 层级 | 模块 | 职责 | 运行环境 |
|------|------|------|---------|
| **UI 层** | Sidebar | 用户界面、交互逻辑 | iframe |
| **协调层** | DataCoordinator | 请求路由、状态管理 | Background |
| | DownloadManager | 下载任务管理 | Background |
| | StateManager | 数据库连接、缓存 | Background |
| **代理层** | APIProxy | API 调用（携带 Cookie） | Content Script |
| | DOMHelper | 页面信息提取 | Content Script |

---

## 3. 详细设计方案

### 3.1 文件结构调整

```
FavGallery/
├── background/
│   ├── index.js                    # Background 入口
│   ├── data-coordinator.js         # ⭐ 新增：数据协调器
│   ├── download-manager.js         # ⭐ 从 core 移过来
│   └── state-manager.js            # ⭐ 新增：状态管理器
├── content/
│   ├── index.js                    # Content Script 入口
│   ├── api-proxy.js                # ⭐ 新增：API 代理
│   └── dom-helper.js               # ⭐ 新增：DOM 辅助
├── core/                           # 保留 UI 相关逻辑
│   ├── app.js
│   ├── message-handler.js          # 简化：只处理 Background 消息
│   └── ui-state-manager.js
└── ...
```

### 3.2 通信协议设计

#### 3.2.1 Sidebar → Background

```javascript
// Sidebar 发送请求
chrome.runtime.sendMessage({
    type: 'LOAD_LIKED_WORKS',
    payload: {
        maxCount: 100
    }
});

// Background 返回结果
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOAD_LIKED_WORKS') {
        const result = await dataCoordinator.loadLikedWorks(message.payload);
        sendResponse(result);
    }
});
```

#### 3.2.2 Background → Content Script

```javascript
// Background 转发请求
chrome.tabs.sendMessage(tabId, {
    type: 'PROXY_API_CALL',
    payload: {
        apiName: 'getLikedWorks',
        params: { maxCount: 100, cachedIds: [...] }
    }
});

// Content Script 执行并返回
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROXY_API_CALL') {
        const result = await apiProxy.call(message.payload.apiName, message.payload.params);
        sendResponse(result);
    }
});
```

### 3.3 核心模块实现

#### 3.3.1 DataCoordinator（数据协调器）

```javascript
// background/data-coordinator.js

export class DataCoordinator {
    constructor() {
        this.stateManager = new StateManager();
    }

    /**
     * 加载点赞作品列表
     */
    async loadLikedWorks(payload) {
        try {
            // 1. 从 IndexedDB 读取缓存
            const cachedItems = await this.stateManager.loadLikedWorks();
            const cachedIds = cachedItems.map(item => item.workId);

            // 2. 获取当前活跃的抖音标签页
            const tabId = await this.getActiveDouyinTab();

            // 3. 转发请求到 Content Script
            const apiResult = await chrome.tabs.sendMessage(tabId, {
                type: 'PROXY_API_CALL',
                payload: {
                    apiName: 'getLikedWorks',
                    params: {
                        maxCount: payload.maxCount,
                        cachedIds: cachedIds,
                        metadata: cachedItems.metadata
                    }
                }
            });

            // 4. 合并数据（在 Background 中完成）
            const mergedData = this.mergeData(cachedItems, apiResult.works);

            // 5. 保存到 IndexedDB
            await this.stateManager.saveLikedWorks(mergedData);

            // 6. 建立关系
            await this.stateManager.buildWorkAuthorRelations(mergedData);

            return {
                works: mergedData,
                total: mergedData.length
            };

        } catch (error) {
            logger.error('加载点赞列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取当前活跃的抖音标签页
     */
    async getActiveDouyinTab() {
        const tabs = await chrome.tabs.query({
            url: '*://*.douyin.com/*'
        });
        
        if (tabs.length === 0) {
            throw new Error('未找到抖音页面，请先打开抖音网页版');
        }

        return tabs[0].id;
    }

    /**
     * 合并数据（支持软删除）
     */
    mergeData(cached, api) {
        const itemMap = new Map();
        
        // 加入缓存
        cached.forEach(item => itemMap.set(item.workId, { ...item }));
        
        // API 覆盖
        api.forEach(item => itemMap.set(item.workId, { ...item, isDeleted: false }));
        
        // 标记软删除
        const apiIds = new Set(api.map(item => item.workId));
        cached.forEach(item => {
            if (!apiIds.has(item.workId) && !item.isDeleted) {
                const existing = itemMap.get(item.workId);
                if (existing) {
                    existing.isDeleted = true;
                }
            }
        });
        
        return Array.from(itemMap.values());
    }
}
```

#### 3.3.2 APIProxy（API 代理）

```javascript
// content/api-proxy.js

import { platformAPI } from '../api/platform-adapter.js';

export class APIProxy {
    /**
     * 调用指定的 API 方法
     */
    async call(apiName, params) {
        switch (apiName) {
            case 'getLikedWorks':
                return await platformAPI.getLikedWorks(
                    params.maxCount,
                    null,  // onProgress 由 Background 处理
                    params.cachedIds,
                    params.metadata
                );
            
            case 'getBookmarkedWorks':
                return await platformAPI.getCollectWorksIncremental(
                    params.collectId,
                    params.maxCount,
                    null,
                    params.cachedIds,
                    params.metadata
                );
            
            case 'getFollowingList':
                return await platformAPI.getFollowingList(
                    params.maxCount,
                    null,
                    params.cachedIds,
                    params.metadata
                );
            
            default:
                throw new Error(`未知的 API: ${apiName}`);
        }
    }
}

// 监听 Background 的请求
const apiProxy = new APIProxy();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROXY_API_CALL') {
        apiProxy.call(message.payload.apiName, message.payload.params)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: error.message }));
        
        return true;  // 保持消息通道开启（异步响应）
    }
});
```

#### 3.3.3 StateManager（状态管理器）

```javascript
// background/state-manager.js

import { database } from '../data/database/database.js';

export class StateManager {
    constructor() {
        this.dbInitialized = false;
    }

    /**
     * 确保数据库已初始化
     */
    async ensureDbInitialized() {
        if (!this.dbInitialized) {
            await database.init();
            this.dbInitialized = true;
        }
    }

    /**
     * 加载点赞作品
     */
    async loadLikedWorks() {
        await this.ensureDbInitialized();
        return await database.getAll('works');  // 简化示例
    }

    /**
     * 保存点赞作品
     */
    async saveLikedWorks(works) {
        await this.ensureDbInitialized();
        await database.save('works', works);
    }

    /**
     * 建立作品-作者关系
     */
    async buildWorkAuthorRelations(works) {
        await this.ensureDbInitialized();
        // ... 关系建立逻辑
    }
}
```

---

## 4. 实施步骤

### Phase 1: 基础设施搭建（2-3天）

1. ✅ 创建 `background/` 目录结构
2. ✅ 实现 `StateManager`（数据库连接池）
3. ✅ 实现 `APIProxy`（Content Script 端）
4. ✅ 配置 `manifest.json` 的 Background 脚本

### Phase 2: 数据协调器（3-4天）

1. ✅ 实现 `DataCoordinator` 核心逻辑
2. ✅ 实现 Background ↔ Content Script 通信
3. ✅ 实现 Sidebar ↔ Background 通信
4. ✅ 迁移点赞列表功能（作为试点）

### Phase 3: 功能迁移（5-7天）

1. ✅ 迁移收藏列表功能
2. ✅ 迁移关注列表功能
3. ✅ 迁移收藏夹列表功能
4. ✅ 迁移下载管理功能

### Phase 4: 测试与优化（3-4天）

1. ✅ 单元测试
2. ✅ 集成测试
3. ✅ 性能优化
4. ✅ 文档更新

---

## 5. 风险评估

### 5.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Content Script 未注入 | 中 | 高 | 添加自动注入逻辑 |
| 跨上下文通信延迟 | 低 | 中 | 使用 Promise 包装，异步处理 |
| Background 内存泄漏 | 低 | 高 | 定期清理缓存，监控内存使用 |
| 多标签页冲突 | 中 | 中 | 使用锁机制，串行化处理 |

### 5.2 兼容性风险

- ✅ **向后兼容**：保留旧的 Content Script 接口，逐步迁移
- ✅ **灰度发布**：先在小部分用户中测试，再全量推广

---

## 6. 收益分析

### 6.1 短期收益（实施后立即可见）

1. ✅ **状态持久化**：页面刷新后下载任务不丢失
2. ✅ **跨标签页同步**：多标签页共享下载队列
3. ✅ **代码清晰度**：职责分离，易于维护

### 6.2 长期收益（未来扩展）

1. ✅ **支持离线任务**：Background 可以定时执行备份
2. ✅ **支持通知推送**：下载完成后发送系统通知
3. ✅ **支持多平台**：更容易扩展到快手、B站等平台

---

## 7. 决策记录

### 为什么现在不实施？

1. **当前架构工作良好**：虽然不完美，但满足需求
2. **重构成本高**：需要修改大量代码，风险较大
3. **抖音 API 限制**：即使重构，Content Script 仍然需要存在
4. **优先级较低**：当前重点是功能稳定性和用户体验

### 什么时候实施？

**触发条件**（满足任一即可）：
- ✅ 项目进入稳定期，有充足时间重构
- ✅ 需要支持跨标签页下载功能
- ✅ 需要支持离线定时任务
- ✅ 团队规模扩大，需要更清晰的架构

---

## 8. 参考资料

- [Chrome Extension Architecture Best Practices](https://developer.chrome.com/docs/extensions/mv3/architecture-overview/)
- [Background Scripts vs Content Scripts](https://developer.chrome.com/docs/extensions/mv3/background_pages/)
- [Message Passing in Chrome Extensions](https://developer.chrome.com/docs/extensions/mv3/messaging/)

---

**文档版本**: v1.0  
**最后更新**: 2026-05-06  
**作者**: FavGallery 开发团队  
**状态**: 📋 规划中（后期需求）

