# FavGallery 项目开发规则

> **本文档是 FavGallery 项目的核心开发规范，所有代码实现必须严格遵守以下规则。**

---

## ⚠️ 重要声明：代码修改权限

**核心原则：未经明确指令，禁止修改任何代码**

- ❌ **禁止**在用户未明确要求时修改代码
- ❌ **禁止**主动优化、重构或调整现有代码
- ❌ **禁止**在未获得确认的情况下添加新功能
- ✅ **允许**在用户明确指示时进行代码修改
- ✅ **允许**提供代码建议和方案供用户选择
- ✅ **允许**分析代码问题并提出改进建议

**工作流程：**
1. 用户提出需求 → AI 分析并提供方案
2. 用户确认方案 → AI 执行代码修改
3. 用户验收结果 → 完成或继续调整

**例外情况：**
- 创建新文档文件（如本规则文档）
- 用户明确要求"立即修复"或"直接修改"
- 紧急的安全漏洞修复（需先通知用户）

---

## 📋 目录

- [⚠️ 代码修改权限](#️-重要声明代码修改权限)
- [一、架构设计规则](#一架构设计规则)
- [二、七大设计原则](#二七大设计原则)
- [三、命名规范](#三命名规范)
- [四、数据层规则](#四数据层规则)
- [五、通信协议规则](#五通信协议规则)
- [六、备份系统规则](#六备份系统规则)
- [七、代码组织规则](#七代码组织规则)

---

## 一、架构设计规则

### 1.1 五层分层架构

项目采用**严格的五层分层架构**，从上到下依次为：

```
┌─────────────────────────┐
│   UI Layer (UI层)       │ ← ui/ 目录
├─────────────────────────┤
│   Core Layer (核心业务层)│ ← core/ 目录
├─────────────────────────┤
│ Content Script Layer    │ ← content/ 目录
├─────────────────────────┤
│   Data Layer (数据层)   │ ← data/ 目录
├─────────────────────────┤
│   API Layer (API适配层) │ ← api/ 目录
├─────────────────────────┤
│  Config Layer (配置层)  │ ← config/ 目录
└─────────────────────────┘
```

**各层职责：**

| 层级 | 目录 | 职责 | 关键文件 |
|------|------|------|---------|
| **UI层** | `ui/` | 用户界面展示和交互逻辑 | `sidebar.html`, `tab-manager.js`, `ui-state-manager.js` |
| **核心业务层** | `core/` | 业务流程控制和消息分发 | `app.js`, `message-handler.js`, `*-manager.js` |
| **Content Script层** | `content/` | 页面中执行数据获取和业务逻辑 | `main.js`, `services/data-fetcher.js`, `services/list-config-factory.js` |
| **数据层** | `data/` | 数据持久化和备份 | `database.js`, `file-system.js`, `backup-manager.js` |
| **API适配层** | `api/` | 平台特定的API调用和数据标准化 | `platform-adapter.js`, `douyin/api.js` |
| **配置层** | `config/` | 全局常量配置 | `constants.js` |

**强制规则：**
- ✅ 上层通过接口调用下层，不直接依赖具体实现
- ✅ 每一层只做自己该做的事情，职责清晰
- ❌ 禁止跨层调用（如 UI 层直接调用 API 层）
- ❌ 禁止循环依赖

---

## 二、七大设计原则

### 2.1 跨平台通用性原则 ⭐⭐⭐

**核心要求：** 所有代码必须支持多平台扩展，**禁止硬编码平台特定值**。

**实施规则：**

1. **动态获取平台信息**
   ```javascript
   // ✅ 正确：通过 platformAPI 动态获取
   const defaultGroup = platformAPI.getDefaultAuthorGroup();
   
   // ❌ 错误：硬编码平台特定值
   const defaultGroup = 'DouYin';
   ```

2. **使用平台适配器**
   ```javascript
   // ✅ 正确：通过适配器调用
   await platformAPI.getFollowingList(maxCount);
   
   // ❌ 错误：直接调用平台特定 API
   await douyinAPI.getFollowingList(maxCount);
   ```

3. **配置驱动的平台信息**
   ```javascript
   // ✅ 正确：从配置读取
   const platformInfo = CONFIG.PLATFORM_INFO[CONFIG.ACTIVE_PLATFORM];
   
   // ❌ 错误：硬编码字符串
   const platformName = '抖音';
   ```

**扩展新平台时：**
- 只需在 `api/` 目录下创建新的平台实现（如 `xiaohongshu/api.js`）
- 在 `platform-adapter.js` 中注册新平台
- **上层代码无需任何修改**

---

### 2.2 配置驱动原则 ⭐⭐⭐

**核心要求：** 使用 `listConfigs` 统一管理列表加载逻辑，不同列表类型通过配置区分。

**实施规则：**

1. **配置与实现分离（工厂模式）**
   
   - **纯数据配置**：存储在 `config/constants.js` 中，只包含静态配置（maxCount、relations、messages等）
   - **工厂类组装**：`content/services/list-config-factory.js` 负责将配置与方法动态组装
   - **使用方透明**：`data-fetcher.js` 通过工厂获取完整配置，不关心平台差异

   ```javascript
   // ✅ constants.js - 纯数据配置
   CONFIG.FETCH_CONFIG.LIST_CONFIGS = {
       liked: {
           maxCount: 100,
           folderRequired: true,
           relations: { groupType: 'liked_group', groupId: 'liked' },
           messages: { loaded: 'LIKED_WORKS_LOADED', ... }
       },
       // ...
   };
   
   // ✅ list-config-factory.js - 工厂组装
   class ListConfigFactory {
       static createConfig(listType) {
           const baseConfig = CONFIG.FETCH_CONFIG.LIST_CONFIGS[listType];
           return {
               ...baseConfig,
               apiFetch: (params) => platformAPI.getLikedWorks(...),
               cacheLoad: (fs) => worksManager.loadLikedWorks(fs),
               cacheSave: (fs, data) => worksManager.saveLikedWorks(fs, data)
           };
       }
   }
   
   // ✅ data-fetcher.js - 使用工厂
   this.listConfigs = ListConfigFactory.createAllConfigs({ backupManager });
   ```

2. **跨平台适配**
   
   工厂模式支持根据不同平台注入不同的实现：
   
   ```javascript
   // ✅ 工厂支持多平台
   static createConfig(listType, platform = CONFIG.ACTIVE_PLATFORM) {
       const baseConfig = CONFIG.FETCH_CONFIG.LIST_CONFIGS[listType];
       
       if (platform === 'douyin') {
           return {
               ...baseConfig,
               apiFetch: (params) => douyinAPI.getLikedWorks(...),
               cacheLoad: (fs) => worksManager.loadLikedWorks(fs)
           };
       } else if (platform === 'xiaohongshu') {
           return {
               ...baseConfig,
               apiFetch: (params) => xiaohongshuAPI.getLikedWorks(...),
               cacheLoad: (fs) => xiaohongshuWorksManager.loadLikedWorks(fs)
           };
       }
   }
   ```

3. **统一的加载方法**
   ```javascript
   // ✅ 正确：复用同一个 _loadListInternal 方法
   async _loadListInternal(listType) {
       const config = this.listConfigs[listType];
       
       // 1. 读取缓存
       const cachedData = await config.cacheLoad();
       
       // 2. 检查是否需要API
       if (!needsAPI(cachedData)) {
           return cachedData;
       }
       
       // 3. 调用API
       const apiData = await config.apiFetch();
       
       // 4. 合并数据
       const mergedData = mergeData(cachedData, apiData);
       
       // 5. 保存数据
       await config.cacheSave(mergedData);
       
       // 6. 建立关系
       await this._buildRelations(mergedData, config.relations);
       
       return mergedData;
   }
   ```

4. **禁止为每个列表写特殊逻辑**
   ```javascript
   // ❌ 错误：为每个列表写独立方法
   async loadLikedWorks() { /* ... */ }
   async loadBookmarkedWorks() { /* ... */ }
   async loadFollowingList() { /* ... */ }
   
   // ✅ 正确：通过配置区分
   async loadList(listType) {
       return this._loadListInternal(listType);
   }
   ```

---

### 2.3 单一职责原则 ⭐⭐

**核心要求：** 每个模块只做一件事，职责清晰分离。

**实施规则：**

1. **cacheSave 只负责保存**
   ```javascript
   // ✅ 正确：saveFollowingAuthors 只保存数据
   async saveFollowingAuthors(authors) {
       await database.save('authors', authors);
       await database.save('author_groups', authorGroups);
       // 不包含关系建立逻辑
   }
   
   // ❌ 错误：既保存数据又建立关系
   async saveFollowingAuthors(authors) {
       await database.save('authors', authors);
       await relationManager.addRelations(/* ... */); // 违背单一职责
   }
   ```

2. **关系建立在 _saveList 中统一处理**
   ```javascript
   // ✅ 正确：通过 _buildRelations 统一处理
   async _saveList(data, config) {
       await config.cacheSave(data);
       await this._buildRelations(data, config.relations);
   }
   
   // _buildRelations 根据配置自动判断
   _buildRelations(data, relationsConfig) {
       switch(relationsConfig.groupType) {
           case 'author_group':
               return this._buildAuthorGroupRelations(data);
           case 'liked_group':
               return this.buildWorkAuthorRelations(data);
           // ...
       }
   }
   ```

---

### 2.4 职责分离的跨上下文通信原则 ⭐⭐⭐

**核心要求：** Content Script 和 Sidebar 严格职责分离，通过 postMessage 通信。

**实施规则：**

1. **Sidebar 只传递意图，不传递完整数据**
   ```javascript
   // ✅ 正确：Sidebar 只发送 workId
   window.parent.postMessage({
       source: 'sidebar',
       type: 'DOWNLOAD_WORK_BY_ID',
       workId: '7xxx',        // 只传 ID
       folderPath: 'xxx'
   }, '*');
   
   // ❌ 错误：Sidebar 传递完整作品数据
   window.parent.postMessage({
       source: 'sidebar',
       type: 'DOWNLOAD_WORK',
       work: { /* 完整作品对象 */ }  // 禁止传递完整数据
   }, '*');
   ```

2. **Content Script 实时获取最新数据**
   ```javascript
   // ✅ 正确：Content Script 收到消息后实时获取详情
   case 'DOWNLOAD_WORK_BY_ID':
       const workDetail = await platformAPI.getWorkDetail(message.workId);
       await downloadWork(workDetail);
   
   // ❌ 错误：直接使用 Sidebar 传来的数据
   case 'DOWNLOAD_WORK':
       await downloadWork(message.work);  // 数据可能过期
   ```

3. **职责划分表**

   | 职责 | Content Script | Sidebar |
   |------|---------------|----------|
   | 文件系统操作 | ✅ | ❌ |
   | 数据库操作 | ✅ | ❌（通过代理） |
   | 下载执行 | ✅ | ❌ |
   | UI 展示 | ❌ | ✅ |
   | 用户交互 | ❌ | ✅ |
   | 数据获取 | ✅ | ❌ |

---

### 2.5 软删除机制 ⭐⭐

**核心要求：** 所有表添加 `isDeleted` 字段，取消操作不物理删除记录。

**实施规则：**

1. **数据库 schema 必须包含 isDeleted**
   ```javascript
   // ✅ 正确：所有表都有 isDeleted 字段
   const stores = {
       works: { keyPath: 'workId', fields: ['isDeleted'] },
       authors: { keyPath: 'uid', fields: ['isDeleted'] },
       collects: { keyPath: 'collectId', fields: ['isDeleted'] },
       relations: { keyPath: 'id', fields: ['isDeleted'] },
       // ...
   };
   ```

2. **取消操作只标记 isDeleted**
   ```javascript
   // ✅ 正确：标记为已删除
   async cancelLike(workId) {
       const work = await database.get('works', workId);
       work.isDeleted = true;
       await database.save('works', work);
   }
   
   // ❌ 错误：物理删除记录
   async cancelLike(workId) {
       await database.delete('works', workId);  // 禁止物理删除
   }
   ```

3. **查询时过滤已删除记录**
   ```javascript
   // ✅ 正确：过滤 isDeleted === true 的记录
   async getActiveWorks() {
       const allWorks = await database.getAll('works');
       return allWorks.filter(work => !work.isDeleted);
   }
   ```

---

### 2.6 关系统一管理原则 ⭐⭐

**核心要求：** 使用单一 `relations` 表管理所有实体间关系，**只插入不删除**。

**实施规则：**

1. **relations 表结构**
   ```javascript
   {
       id: 'auto-generated',
       sourceType: 'work' | 'author' | 'collect',
       sourceId: 'xxx',
       targetType: 'author' | 'author_group' | 'liked_group',
       targetId: 'xxx',
       createdAt: timestamp,
       isDeleted: false  // 软删除标记
   }
   ```

2. **只插入不删除**
   ```javascript
   // ✅ 正确：取消点赞时标记 isDeleted
   async cancelLike(workId) {
       const relation = await findRelation('work', workId, 'liked_group');
       relation.isDeleted = true;
       await database.save('relations', relation);
   }
   
   // ❌ 错误：删除关系记录
   async cancelLike(workId) {
       await database.delete('relations', relationId);  // 禁止删除
   }
   ```

3. **保留历史记录**
   - 即使取消点赞也保留历史记录
   - 通过 `isDeleted` 标记失效关系
   - 便于数据分析和恢复

---

### 2.7 增量备份策略 ⭐⭐

**核心要求：** 使用哈希对比检测数据变化，无变化跳过备份。

**实施规则：**

1. **哈希对比机制**
   ```javascript
   // backup-manager.js
   async performFullBackup() {
       // 1. 加载 manifest（包含上次备份的哈希值）
       const manifest = await this._loadManifest();
       
       // 2. 备份每个表前先计算哈希
       const currentHash = this._calculateHash(currentData);
       const oldHash = manifest.hashes['authors'];
       
       // 3. 只有哈希不同时才备份
       if (this.needsBackup(oldHash, currentHash)) {
           await this.backupTable('authors', currentData);
           manifest.hashes['authors'] = currentHash;
       } else {
           logger.info('✅ 数据无变化，跳过备份');
       }
       
       // 4. 更新 manifest
       await this._saveManifest(manifest);
   }
   ```

2. **季度分片存储**
   ```javascript
   // works 表按 createTime 分片
   // 文件名格式：works_2024_Q1.json.gz
   generateBackupPath(basePath, dataType, timestamp) {
       const { year, quarter } = this.getQuarterInfo(timestamp);
       return `${basePath}/${dataType}/works_${year}_Q${quarter}.json.gz`;
   }
   ```

3. **多重触发机制**
   - 定时备份：默认 10 分钟
   - 列表加载：每 5 批触发一次
   - 下载完成后立即备份

---

## 三、命名规范

### 3.1 术语统一 ⭐⭐⭐

**强制规则：** 使用统一的术语，禁止混用。

| 概念 | ✅ 正确术语 | ❌ 禁止术语 | 说明 |
|------|-----------|-----------|------|
| 作品 | `work` / `workId` | `video` / `awemeId` | 作品包含视频和图集 |
| 作者 | `author` / `uid` | `user` / `userId` | 统一使用 author |
| 收藏 | `collect` / `collectId` | `favorite` / `favId` | 统一使用 collect |
| 点赞 | `liked` / `like` | `favorited` | 点赞使用 liked |
| 关注 | `following` / `follow` | `subscribed` | 关注使用 following |
| 平台ID | `platformId` | `sec_uid` | 禁止使用平台特定名称 |

**示例：**
```javascript
// ✅ 正确
const workId = '7xxx';
const authorUid = 'MS4wLjABAAAA...';
const collectId = '123';

// ❌ 错误
const videoId = '7xxx';           // 应该用 workId
const userId = 'MS4wLjABAAAA...'; // 应该用 uid
const secUid = 'MS4wLjABAAAA...'; // 应该用 platformId
```

---

### 3.2 命名风格 ⭐⭐

**强制规则：** 所有变量和字段使用驼峰命名。

```javascript
// ✅ 正确：驼峰命名
const workId = '7xxx';
const createTime = Date.now();
const platformId = 'xxx';
const authorNickname = '张三';

// ❌ 错误：下划线命名
const work_id = '7xxx';
const create_time = Date.now();
const platform_id = 'xxx';

// ❌ 错误：前缀下划线
const _id = 'xxx';
const _type = 'work';
```

---

### 3.3 文件命名 ⭐

**强制规则：** 使用小写字母加连字符。

```
✅ 正确：
- data-fetcher.js
- backup-manager.js
- platform-helpers.js
- work-list-manager.js

❌ 错误：
- DataFetcher.js
- backupManager.js
- platformHelpers.js
```

---

### 3.4 一致性命名模式 ⭐

**强制规则：** 类和函数命名遵循统一模式。

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| 管理类 | `*Manager` | `DownloadManager`, `BackupManager` |
| 处理器类 | `*Handler` | `MessageHandler`, `DownloadHandler` |
| 处理方法 | `handle*` | `handleDownload`, `handleLoad` |
| 辅助函数文件 | `*-helpers.js` | `platform-helpers.js`, `ui-helpers.js` |

---

## 四、数据层规则

### 4.1 数据库设计规范

**对象存储（Stores）：**

| Store | 主键 | 必填字段 | 说明 |
|-------|------|---------|------|
| `works` | `workId` | `isDeleted` | 作品元数据 |
| `completed_works` | `workId` | `downloadTime` | 已完成作品ID |
| `relations` | `id` | `sourceType`, `targetType`, `isDeleted` | 通用关系表 |
| `liked_group` | `groupId` | `isDeleted` | 点赞分组元数据 |
| `authors` | `uid` | `isDeleted` | 作者列表元数据 |
| `collects` | `collectId` | `isDeleted` | 收藏夹列表元数据 |
| `author_groups` | `groupId` | `isDeleted` | 作者分组元数据 |
| `settings` | `key` | - | 系统设置 |

**索引设计：**
```javascript
indexes: {
    works: [
        { name: 'authorId', keyPath: 'author.uid', unique: false },
        { name: 'createTime', keyPath: 'createTime', unique: false }
    ],
    relations: [
        { name: 'source', keyPath: ['sourceType', 'sourceId'], unique: false },
        { name: 'target', keyPath: ['targetType', 'targetId'], unique: false },
        { name: 'sourceToTarget', keyPath: ['sourceType', 'sourceId', 'targetType', 'targetId'], unique: true }
    ]
}
```

---

### 4.2 文件系统目录结构

```
用户选择的根目录/
├── .FavGallery/              # 应用数据（隐藏）
│   ├── metadata/
│   │   └── douyin/           # 按平台分类
│   │       ├── manifest.json # 备份清单（含哈希值）
│   │       ├── authors.js
│   │       └── works/
│   │           ├── works_2024_Q1.json.gz
│   │           └── works_2024_Q2.json.gz
│   ├── logs/
│   │   └── douyin/
│   └── resources/js/
└── 抖音/                      # 媒体文件
    └── 作者昵称(uid)/
        ├── 封面/
        ├── 视频/
        └── 图集/
```

**强制规则：**
- ✅ 元数据按平台分类存储
- ✅ works 表按季度分片并压缩（.json.gz）
- ✅ 媒体文件按作者分类存储
- ❌ 禁止将所有数据放在同一目录

---

## 五、通信协议规则

### 5.1 Sidebar → Content Script 消息

**消息格式：**
```javascript
{
    source: 'sidebar',
    type: 'MESSAGE_TYPE',
    // 其他字段根据消息类型而定
}
```

**支持的消息类型：**

| 消息类型 | 必需字段 | 说明 |
|---------|---------|------|
| `LOAD_LIKED_WORKS` | `maxCount` | 加载点赞列表 |
| `LOAD_COLLECTS_LIST` | - | 加载收藏夹列表 |
| `LOAD_COLLECT_WORKS` | `collectIds` | 加载收藏夹作品 |
| `LOAD_FOLLOWING_AUTHORS` | `maxCount` | 加载关注作者列表 |
| `DOWNLOAD_WORK_BY_ID` | `workId`, `folderPath` | 下载单个作品 |
| `DOWNLOAD_AUTHOR_WORKS` | `uid`, `platformId`, `nickname`, `folderPath`, `batchId` | 下载作者所有作品 |
| `BATCH_DOWNLOAD_WORKS` | `workIds`, `folderPath`, `batchId` | 批量下载 |
| `STOP_BATCH_DOWNLOAD` | `batchId` | 停止批量下载 |
| `SELECT_FOLDER` | - | 选择文件夹 |
| `GET_USER_INFO` | - | 获取用户信息 |
| `GET_DOWNLOADED_WORK_IDS` | - | 查询已下载作品ID |
| `CHANGE_SIDEBAR_MODE` | `mode` | 切换侧边栏显示模式（hover/squeeze） |
| `GET_SIDEBAR_MODE` | - | 获取当前侧边栏显示模式 |

**示例：**
```javascript
// ✅ 正确：只传递 workId
window.parent.postMessage({
    source: 'sidebar',
    type: 'DOWNLOAD_WORK_BY_ID',
    workId: '7xxx',
    folderPath: '抖音/作者(UID)/视频'
}, '*');
```

---

### 5.2 Content Script → Sidebar 消息

**消息格式：**
```javascript
{
    source: 'content',
    type: 'MESSAGE_TYPE',
    // 其他字段根据消息类型而定
}
```

**支持的消息类型：**

| 消息类型 | 必需字段 | 说明 |
|---------|---------|------|
| `LIKED_WORKS_LOADED` | `works`, `total` | 点赞列表加载完成 |
| `BOOKMARKED_WORKS_LOADED` | `works`, `total` | 收藏列表加载完成 |
| `FOLLOWING_AUTHORS_LOADED` | `authors`, `total` | 关注作者列表加载完成 |
| `COLLECTS_LIST_LOADED` | `collects`, `total` | 收藏夹列表加载完成 |
| `COLLECT_WORKS_LOADED` | `works`, `total`, `collectIds` | 收藏夹作品加载完成 |
| `COLLECT_WORKS_ERROR` | `error` | 收藏夹作品加载错误 |
| `DOWNLOAD_SUCCESS` | `workId`, `result` | 下载成功 |
| `DOWNLOAD_FAILED` | `workId`, `error` | 下载失败 |
| `BATCH_DOWNLOAD_ITEM_START` | `workId` | 批量下载单个项目开始 |
| `BATCH_DOWNLOAD_PROGRESS` | `batchId`, `progress` | 批量下载进度 |
| `BATCH_DOWNLOAD_COMPLETE` | `batchId`, `result`, `stopped` | 批量下载完成 |
| `BATCH_DOWNLOAD_ERROR` | `batchId`, `error` | 批量下载错误 |
| `AUTHOR_WORKS_COUNT` | `uid`, `count`, `skippedCount` | 作者作品数量统计（count=总数，skippedCount=已下载数） |
| `AUTHOR_WORK_PROGRESS` | `uid`, `workId`, `status` | 作者作品下载进度 |
| `AUTHOR_DOWNLOAD_COMPLETED` | `uid` | 作者下载完成，禁用复选框 |
| `DB_RESPONSE_GET_DOWNLOADED_WORK_IDS` | `workIds` | 数据库查询响应 |
| `USER_INFO` | `userInfo` | 用户信息返回 |
| `SIDEBAR_MODE_RESPONSE` | `mode` | 返回侧边栏显示模式（hover/squeeze） |
| `UI_LOG` | `level`, `message` | UI日志同步 |

**示例：**
```javascript
// ✅ 正确：包含 stopped 标志
iframe.contentWindow.postMessage({
    source: 'content',
    type: 'BATCH_DOWNLOAD_COMPLETE',
    batchId: 'batch_xxx',
    result: {
        progress: { total: 10, current: 10, success: 8, failed: 2 },
        results: [...]
    },
    stopped: false  // 区分正常完成和被停止
}, '*');
```

---

## 六、备份系统规则

### 6.1 manifest.json 结构

```json
{
    "version": "1.0",
    "lastBackupTime": 1234567890,
    "hashes": {
        "authors": "abc123...",
        "collects": "def456...",
        "works_2024_Q1": "ghi789...",
        "works_2024_Q2": "jkl012...",
        "relations": "mno345...",
        "settings": "pqr678..."
    }
}
```

**强制规则：**
- ✅ 必须记录每个表的哈希值
- ✅ 必须记录最后备份时间
- ✅ works 表按季度分别记录哈希

---

### 6.2 备份触发时机

| 触发场景 | 触发条件 | 说明 |
|---------|---------|------|
| 定时备份 | 每 10 分钟 | 可配置间隔 |
| 列表加载 | 每 5 批（约100个作品） | 阶段性备份 |
| 下载完成 | 每 10 个作品或 1 分钟 | 混合策略 |
| 设置修改 | 立即备份 | 即时备份 |

---

### 6.3 备份完整性验证

```javascript
// 备份时必须包含元数据
const backupData = {
    metadata: {
        version: '1.0',
        backupTime: Date.now(),
        recordCount: dataList.length,
        hash: calculatedHash
    },
    data: dataList
};

// 恢复时验证完整性
async verifyBackupIntegrity(backupData, expectedHash) {
    const actualHash = this._calculateHash(backupData.data);
    return actualHash === expectedHash;
}
```

---

## 七、代码组织规则

### 7.1 模块职责划分

**强制规则：**

| 模块 | 职责 | 禁止事项 |
|------|------|---------|
| `database.js` | IndexedDB 封装 | 不包含业务逻辑 |
| `file-system.js` | 文件系统操作 | 不包含备份策略 |
| `backup-manager.js` | 备份管理 | 不直接操作数据库 |
| `relation-manager.js` | 关系表管理 | 不处理业务逻辑 |
| `settings-manager.js` | 设置管理 | 不包含业务逻辑 |
| `platform-adapter.js` | 平台适配 | 不包含 UI 逻辑 |
| `data-fetcher.js` | 数据获取 | 不包含 UI 渲染 |
| `list-config-factory.js` | 列表配置工厂 | 不包含业务逻辑，只负责组装配置和方法 |

---

### 7.2 错误处理规范

**强制规则：**

1. **所有异步操作必须有 try-catch**
   ```javascript
   async loadData() {
       try {
           const data = await fetch();
           return data;
       } catch (error) {
           logger.error('❌ 加载数据失败:', error);
           throw error;  // 或返回默认值
       }
   }
   ```

2. **关键节点添加日志**
   ```javascript
   logger.info('🚀 开始加载点赞列表...');
   logger.info(`✅ 加载完成: 共 ${total} 个作品`);
   logger.error('❌ 加载失败:', error.message);
   ```

3. **双日志设计**
   - 控制台日志：`console.log`
   - 文件日志：`fileLogger.write()`

---

### 7.3 性能优化规范

**强制规则：**

1. **批量查询优于逐个查询**
   ```javascript
   // ✅ 正确：批量查询
   const downloadedIds = await databaseProxy.getDownloadedWorkIds();
   worksWithStatus = works.map(work => ({
       ...work,
       isDownloaded: downloadedIds.has(work.workId)
   }));
   
   // ❌ 错误：N+1 查询
   for (const work of works) {
       work.isDownloaded = await database.isDownloaded(work.workId);
   }
   ```

2. **避免重复计算**
   ```javascript
   // ✅ 正确：缓存计算结果
   const totalPages = this.getTotalPages();
   
   // ❌ 错误：每次都重新计算
   for (let i = 0; i < 10; i++) {
       const pages = Math.ceil(total / pageSize);
   }
   ```

---

## 📝 总结

本文档定义了 FavGallery 项目的核心开发规则，所有开发人员必须严格遵守。违反这些规则将导致：

- ❌ 代码审查不通过
- ❌ 无法保证跨平台兼容性
- ❌ 维护成本大幅增加
- ❌ 数据一致性问题

**优先级说明：**
- ⭐⭐⭐ 必须严格遵守（违反将导致严重问题）
- ⭐⭐ 强烈建议遵守（违反将增加维护难度）
- ⭐ 建议遵守（最佳实践）

---

**文档版本：** v1.0  
**最后更新：** 2026-05-06  
**维护者：** FavGallery 开发团队

