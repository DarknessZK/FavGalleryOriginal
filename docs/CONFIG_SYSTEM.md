# FavGallery 配置系统设计文档

> **定位**：本文档描述 FavGallery 的用户配置系统——包括**已实现**的 `.FavGallery/config.json` 配置文件方案，以及**规划中**的界面配置面板（用于可视化调整 backup 等配置项）。
>
> **状态图例**：✅ 已实现　🔜 规划中（尚未落地）

---

## 一、设计目标

1. **配置与代码分离**：用户可调参数（当前为各列表加载数量 `maxCount`）从代码常量迁移到用户目录下的配置文件，改配置无需改代码、无需重新加载扩展。
2. **随文件夹走**：配置文件存放在用户选择的根目录 `.FavGallery/config.json`，与元数据、日志同属一个数据目录，便于备份与迁移。
3. **单一数据源**：默认值由 `config/constants.js` 的 `FETCH_CONFIG.LIST_CONFIGS` 派生，避免"常量表 + 配置文件"两处硬编码漂移。
4. **向前兼容**：旧配置文件缺失的新字段，加载时自动用默认值补齐。
5. **面向未来**：为规划中的界面配置面板（含 backup 配置项）预留统一的读写入口。

---

## 二、配置文件规格 ✅

### 2.1 位置与格式

- **路径**：`.FavGallery/config.json`（全局，跨平台共享，不按平台分目录）
- **格式**：JSON，2 空格缩进
- **生成时机**：用户首次"选择文件夹"后自动生成；已存在则读取

### 2.2 当前结构

```json
{
  "version": 1,
  "listMaxCount": {
    "liked": 120,
    "bookmarked": 60,
    "following": 60,
    "collects": 100
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | number | 配置结构版本号，结构变更时递增，用于迁移兼容 |
| `listMaxCount` | object | 各列表的最大加载数量，键为列表类型 |
| `listMaxCount.liked` | number | 点赞列表加载上限 |
| `listMaxCount.bookmarked` | number | 收藏夹作品加载上限 |
| `listMaxCount.following` | number | 关注作者加载上限 |
| `listMaxCount.collects` | number | 收藏夹列表加载上限 |

> **说明**：`listMaxCount` 的默认值与 `LIST_CONFIGS[*].maxCount` 一致，由代码在生成时派生，不在文档中重复维护具体数值。

---

## 三、运行时架构 ✅

### 3.1 上下文约束（关键）

Sidebar（iframe）与 Content Script 是**两个独立的 JS 上下文**，各自持有一份 `CONFIG` 模块副本：

- **只有 Content Script 拥有 File System Access API 权限**，因此配置文件的读写只能发生在 Content Script 侧。
- Sidebar 侧的 `CONFIG` 是静态默认值，**永远不会**被配置文件更新。所以 Sidebar **不再**在消息里传 `maxCount`，加载数量统一由 Content Script 侧的配置驱动。

### 3.2 模块职责

| 模块 | 职责 |
|------|------|
| `config/constants.js` | 定义 `FILE_SYSTEM.CONFIG_FILE` 路径、`USER_CONFIG.VERSION` 版本号；`LIST_CONFIGS` 作为默认值来源 |
| `config/user-config.js` | 运行时配置管理器（单例 `userConfig`）：加载/生成/合并/应用配置 |
| `data/storage/file-system.js` | 底层文件 IO：`readUserConfig()` / `writeUserConfig(config)` |
| `content/services/data-fetcher.js` | `reloadConfigs()`：配置变更后重建 `listConfigs` |
| `content/main.js` | 在 `selectFolder()` 中编排：初始化文件系统 → 加载配置 → 重建列表配置 |

### 3.3 加载流程

```
用户点击"选择文件夹"
        │
        ▼
fileSystem.setRootDirectory(dirHandle)
fileSystem.init()                       // 初始化 IndexedDB + 文件日志
        │
        ▼
userConfig.ensureConfig(fileSystem)
        │
        ├─ readUserConfig()             // 读 .FavGallery/config.json
        │       │
        │       ├─ 存在 → JSON.parse
        │       └─ 不存在/损坏 → buildDefault()（从 LIST_CONFIGS 派生）→ writeUserConfig()
        │
        ├─ _mergeWithDefault()          // 深合并，补齐缺失字段（向前兼容）
        │
        └─ _applyToListConfigs()        // 把 maxCount 写回 CONFIG.FETCH_CONFIG.LIST_CONFIGS
        │
        ▼
dataFetcher.reloadConfigs()             // 用最新 CONFIG 重建 listConfigs 快照
        │
        ▼
后续列表加载读取 config.maxCount        // 已由配置文件驱动
```

### 3.4 为什么要 `reloadConfigs()`

`dataFetcher.listConfigs` 在 `DataFetcher` 构造时通过 `{ ...baseConfig }` **展开固化**了 `LIST_CONFIGS` 的快照。`ensureConfig` 修改的是 `CONFIG.FETCH_CONFIG.LIST_CONFIGS`（内存单例），已固化的 `listConfigs` 不会自动更新，因此必须显式重建。重建顺序：**先 `ensureConfig`（改 CONFIG）→ 再 `reloadConfigs`（读 CONFIG）**。

### 3.5 maxCount 生效链路

```
配置文件 listMaxCount.liked
   → _applyToListConfigs 写回 CONFIG.FETCH_CONFIG.LIST_CONFIGS.liked.maxCount
   → reloadConfigs 重建 listConfigs.liked.maxCount
   → data-fetcher._loadListInternal: config.maxCount（API 拉取目标 + 合并后 slice 截断）
```

Sidebar 发起加载时不再携带 `maxCount`，Content Script 的 `extraParams` 为空，`_loadListInternal` 使用 `config.maxCount`。

---

## 四、边界与容错 ✅

| 场景 | 处理方式 |
|------|---------|
| 配置文件不存在 | 用默认值生成并写入，本次运行使用默认值 |
| 配置文件 JSON 损坏 | `readUserConfig` 返回 `null`，回退到默认配置，记录 warn 日志 |
| 缺失部分字段 | `_mergeWithDefault` 深合并补齐（如旧文件无 `collects`） |
| `maxCount` 非法（非正数/非数字） | 忽略该项，保留默认值，记录 warn 日志 |
| 未知列表类型键 | 忽略，记录 warn 日志 |
| 写入配置文件失败 | 不阻断主流程，本次运行仍使用内存中的配置，记录 warn 日志 |

---

## 五、规划中：界面配置面板 🔜

> **本节为设计规划，尚未实现。** 目的是让用户在 Sidebar 界面直接调整配置，无需手动编辑 JSON。

### 5.1 目标

在 Sidebar 增加一个"配置"入口（面板/弹窗），可视化读写 `.FavGallery/config.json`。

### 5.2 首个纳入的配置项：backup 🔜

当前 `BACKUP_CONFIG`（定时备份间隔、阶段性备份批次、下载备份阈值、立即备份延迟等）仍是 `constants.js` 中的静态常量，**暂不写入配置文件**。规划将其纳入配置面板，允许用户调整，例如：

| 配置项 | 含义 | 当前默认（constants.js） |
|--------|------|--------------------------|
| `backup.interval` | 定时备份间隔 | 10 分钟 |
| `backup.enabled` | 是否启用定时备份 | false |
| `backup.listBackup.batchInterval` | 每 N 批备份一次 | 5 |
| `backup.downloadBackup.timeThreshold` | 下载备份时间阈值 | 1 分钟 |
| `backup.downloadBackup.countThreshold` | 下载备份数量阈值 | 10 条 |
| `backup.downloadBackup.immediateBackup.delay` | 立即备份延迟 | 5 秒 |

### 5.3 面板交互设计要点（草案）

1. **读写通道**：面板在 Sidebar 侧，但文件读写在 Content Script 侧。需新增一对消息：
   - `GET_USER_CONFIG`：Sidebar → Content Script，请求当前配置
   - `SAVE_USER_CONFIG`：Sidebar → Content Script，提交修改后的配置
2. **保存后生效**：Content Script 收到 `SAVE_USER_CONFIG` 后 `writeUserConfig()` → `ensureConfig()`（或直接应用）→ `reloadConfigs()`，无需重选文件夹即时生效。
3. **校验**：数值项做范围校验（如 `maxCount > 0`、`interval` 下限），非法输入拒绝保存并提示。
4. **版本迁移**：保存时写入当前 `USER_CONFIG.VERSION`；加载时若版本落后，执行迁移补齐。

### 5.4 配置文件结构演进（示意）

纳入 backup 后，配置文件将扩展为：

```json
{
  "version": 2,
  "listMaxCount": { "liked": 120, "bookmarked": 60, "following": 60, "collects": 100 },
  "backup": {
    "interval": 600000,
    "enabled": false,
    "listBackup": { "batchInterval": 5, "enabled": true },
    "downloadBackup": { "timeThreshold": 60000, "countThreshold": 10, "enabled": true }
  }
}
```

> 演进时通过 `version` 字段 + `_mergeWithDefault` 的深合并策略保证旧文件平滑升级。

---

## 六、扩展新配置项的步骤 ✅

以后要把某个 `constants.js` 常量变成用户可配置项，按以下步骤：

1. 在 `user-config.js` 的 `buildDefault()` 中从对应常量派生默认字段。
2. 在 `_mergeWithDefault()` 中补充该字段的合并逻辑（嵌套对象需深合并）。
3. 在 `_applyToListConfigs()`（或新增 `_applyToXxx()`）中把值写回目标常量。
4. 若写回的常量在 `listConfigs` 构造时被固化，确保 `reloadConfigs()` 覆盖到。
5. 更新本文档第二、五节的结构说明，并递增 `USER_CONFIG.VERSION`（若结构不兼容）。

---

## 七、关键代码位置索引

| 功能 | 文件 |
|------|------|
| 路径/版本常量 | `config/constants.js` → `FILE_SYSTEM.CONFIG_FILE`、`USER_CONFIG.VERSION` |
| 配置管理器 | `config/user-config.js` → `userConfig`（`ensureConfig` / `buildDefault` / `getMaxCount`） |
| 文件读写 | `data/storage/file-system.js` → `readUserConfig` / `writeUserConfig` |
| 配置重建 | `content/services/data-fetcher.js` → `reloadConfigs` |
| 编排入口 | `content/main.js` → `selectFolder` |

---

**最后更新**：2026-09-14
**维护者**：FavGallery 开发团队
