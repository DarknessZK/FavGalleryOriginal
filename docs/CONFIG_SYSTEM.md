# FavGallery 配置系统设计文档

> **定位**：本文档描述 FavGallery 的用户配置系统——包括 `.FavGallery/config.json` 配置文件方案（v2，含 backup 段）与**已实现**的界面配置面板（Sidebar 可视化读写）。
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

### 2.2 当前结构（version 2）✅

```json
{
  "version": 2,
  "listMaxCount": {
    "liked": 120,
    "bookmarked": 60,
    "following": 60,
    "collects": 100
  },
  "backup": {
    "interval": 600000,
    "enabled": false,
    "listBackup": { "batchInterval": 5, "enabled": true },
    "downloadBackup": {
      "timeThreshold": 60000,
      "countThreshold": 10,
      "enabled": true,
      "immediateBackup": { "enabled": true, "delay": 5000 }
    }
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
| `backup.interval` | number | 定时备份间隔（毫秒） |
| `backup.enabled` | boolean | 是否启用定时备份 |
| `backup.listBackup.batchInterval` | number | 列表备份每 N 批执行一次 |
| `backup.listBackup.enabled` | boolean | 是否启用列表阶段性备份 |
| `backup.downloadBackup.timeThreshold` | number | 下载备份时间阈值（毫秒） |
| `backup.downloadBackup.countThreshold` | number | 下载备份数量阈值（条） |
| `backup.downloadBackup.enabled` | boolean | 是否启用下载备份 |
| `backup.downloadBackup.immediateBackup.enabled` | boolean | 是否启用立即备份 |
| `backup.downloadBackup.immediateBackup.delay` | number | 立即备份延迟（毫秒） |

> **说明**：`listMaxCount` 默认值由 `LIST_CONFIGS[*].maxCount` 派生、`backup` 段默认值由 `BACKUP_CONFIG` 派生（单一数据源），具体数值以 `config/constants.js` 为准，不在文档中重复维护。
>
> **v1 → v2 迁移**：无需迁移脚本。旧 v1 文件缺失的 `backup` 段由 `_mergeWithDefault` 逐层深合并自动补默认，首次加载后即视为 v2（保存或重写盘后 `version` 变为 2）。

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
        ├─ _mergeWithDefault()          // 逐层深合并，补齐缺失字段（向前兼容，含 backup 段）
        │
        ├─ _applyToListConfigs()        // 把 maxCount 写回 CONFIG.FETCH_CONFIG.LIST_CONFIGS
        │
        └─ _applyToBackupConfig()       // 把 backup 段写回 CONFIG.BACKUP_CONFIG（合法值覆盖，非法保留默认）
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
| `backup` 段非法值（非正数/非布尔） | `_applyToBackupConfig` 拒绝写回，保留运行时当前值，记录 warn 日志 |
| 面板提交非法值 | 前端校验标红拒绝提交；Content 侧 `_sanitizeAgainst` 回退到运行时当前值（双重防线） |
| 保存写盘失败 | `userConfig.save()` 抛错 → `SAVE_USER_CONFIG_RESULT {success:false}` → 面板提示 + 错误红条，运行时配置不变 |
| 未知列表类型键 | 忽略，记录 warn 日志 |
| 写入配置文件失败 | 不阻断主流程，本次运行仍使用内存中的配置，记录 warn 日志 |

---

## 五、界面配置面板 ✅

> **已实现**。用户在 Sidebar 界面直接调整配置，无需手动编辑 JSON。

### 5.1 入口与布局

侧边栏「存储位置」下方的「⚙️ 配置」可折叠区（默认收起），由 `core/config-panel.js` 驱动，包含：

- **列表加载上限**：点赞/收藏作品/关注/收藏夹 4 个数字输入（1 ~ 10000）
- **备份**：启用定时备份、备份间隔（分钟）
- **列表备份**：启用、每 N 批备份一次
- **下载备份**：启用、时间阈值（分钟）、数量阈值（条）；立即备份：启用、延迟（秒）
- **保存 / 恢复默认** 按钮与顶部提示条

> **单位约定**：面板用人类友好单位（分钟/秒），保存时换算回毫秒落盘；回填时逆向换算。

### 5.2 纳入的配置项（backup 段全部字段 + listMaxCount）

`backup` 段已迁入 config.json（v2），默认值从 `constants.js` 的 `BACKUP_CONFIG` 派生，运行时由 `_applyToBackupConfig()` 写回内存单例，字段含义见 2.2 表格。尚未纳入：download 文件名格式等其他可配置项。

### 5.3 读写通道与交互细节

1. **读写通道**（面板在 Sidebar 侧，文件读写在 Content Script 侧）：
   - `GET_USER_CONFIG` → Content 回 `USER_CONFIG_LOADED {success, config, defaults}`；未选文件夹时回 `{success:false, error:'请先选择文件夹'}`，面板控件禁用并提示
   - `SAVE_USER_CONFIG`（携编辑后的 config）→ Content 回 `SAVE_USER_CONFIG_RESULT {success, config|error}`
2. **首次展开发起拉取**；「恢复默认」仅按 GET 响应里的 `defaults` 回填表单，**不直接保存**，点「保存」才写盘。
3. **保存链路**：`userConfig.save(fileSystem, patchConfig)` = 与当前配置深合并 → `_sanitizeAgainst` 校验（非法回退运行时当前值）→ `writeUserConfig()` → 重新 apply（LIST_CONFIGS + BACKUP_CONFIG）→ 回包生效配置。
4. **保存后生效**：Content 侧 `dataFetcher.reloadConfigs()` 重建列表配置快照；定时备份同步启停对齐（`backup.enabled=true` → `startPeriodicBackup()`，false → `stopPeriodicBackup()`，两方法均幂等，interval 变更重起生效）。
5. **校验**：前端非法输入标红拒绝提交；失败时复用错误边界（红条 + 日志）。成功后按 RESULT 回填并提示。
6. **版本迁移**：保存时写入当前 `USER_CONFIG.version`；加载时靠 `_mergeWithDefault` 深合并自动补齐缺失段。

### 5.4 已知边界：定时备份启动时序

`file-system.init()` 里定时备份的启动判定发生在 `ensureConfig()` **之前**：选择文件夹后的本次首启按静态默认（`enabled:false`）判定；在配置面板保存启用后备份会立即补偿启动（5.3 第 4 步），下次选同一文件夹时即按配置文件驱动。

---

## 六、扩展新配置项的步骤 ✅

以后要把某个 `constants.js` 常量变成用户可配置项，按以下步骤：

1. 在 `user-config.js` 的 `buildDefault()` 中从对应常量派生默认字段。
2. 在 `_mergeWithDefault()` 中补充该字段的合并逻辑（嵌套对象需深合并）。
3. 在 `_applyToListConfigs()` / `_applyToBackupConfig()`（或新增 `_applyToXxx()`）中把值写回目标常量。
4. 若写回的常量在 `listConfigs` 构造时被固化，确保 `reloadConfigs()` 覆盖到。
5. 在 `core/config-panel.js` 的 `FIELD_SPECS` 中增加字段映射（含单位换算与校验范围），并在 `ui/html/sidebar.html` 面板加控件。
6. 更新本文档第二、五节的结构说明，并递增 `USER_CONFIG.version`（若结构不兼容）。

---

## 七、关键代码位置索引

| 功能 | 文件 |
|------|------|
| 路径/版本常量 | `config/constants.js` → `FILE_SYSTEM.CONFIG_FILE`、`USER_CONFIG.version` |
| 配置管理器 | `config/user-config.js` → `userConfig`（`ensureConfig` / `buildDefault` / `save` / `getMaxCount` / `_applyToBackupConfig`） |
| 文件读写 | `data/storage/file-system.js` → `readUserConfig` / `writeUserConfig` |
| 配置重建 | `content/services/data-fetcher.js` → `reloadConfigs` |
| 编排入口 | `content/main.js` → `selectFolder` |
| 消息通道 | `content/main.js` → `GET_USER_CONFIG` / `SAVE_USER_CONFIG` 处理；`core/message-handler.js` → `USER_CONFIG_LOADED` / `SAVE_USER_CONFIG_RESULT` 分支 |
| 面板 UI | `core/config-panel.js` + `ui/html/sidebar.html`（配置折叠区）+ `ui/css/sidebar.css`（`.cfg-*`） |
| 备份启停对齐 | `data/backup/backup-manager.js` → `startPeriodicBackup` / `stopPeriodicBackup` |

---

**最后更新**：2026-09-26
**维护者**：FavGallery 开发团队
