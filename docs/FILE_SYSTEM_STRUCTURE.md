# FavGallery 文件系统目录结构规范

> **重要**：本文档定义了 FavGallery 扩展在用户本地文件系统中的目录结构和文件组织方式。所有涉及文件读写的代码必须遵循此规范。

---

## 一、整体架构

```
用户选择的根目录/
├── .FavGallery/                         ← 系统文件（隐藏文件夹）
│   ├── config.json                      ← 用户配置文件（全局，跨平台共享）
│   ├── metadata/                        ← 元数据和备份数据（按平台分类）
│   │   ├── douyin/                      ← 抖音平台数据
│   │   │   ├── manifest.json            ← 备份清单（记录哈希值和时间戳）
│   │   │   ├── authors.js               ← 作者基础信息
│   │   │   ├── collects.js              ← 收藏夹数据
│   │   │   ├── author_groups.js         ← 作者分组数据
│   │   │   ├── liked_group.js           ← 点赞分组数据
│   │   │   ├── relations.js             ← 关系数据
│   │   │   ├── completed_works.ndjson   ← 已完成作品数据（NDJSON增量格式）
│   │   │   ├── settings.json            ← 系统设置（JSON格式）
│   │   │   ├── following_status.js      ← 关注状态缓存
│   │   │   ├── liked_works.js           ← 点赞作品缓存
│   │   │   ├── bookmarked_works.js      ← 收藏作品缓存
│   │   │   └── works/                   ← works 表按季度分片
│   │   │       ├── works_2024_Q1.json
│   │   │       ├── works_2024_Q2.json
│   │   │       └── ...
│   │   └── kuaishou/                    ← 快手平台数据（未来扩展）
│   ├── logs/                            ← 日志文件（按平台分类）
│   │   ├── douyin/
│   │   │   └── app.log
│   │   └── kuaishou/
│   └── resources/                       ← 资源文件
│       └── js/                          ← JS/CSS 资源（预留）
├── 抖音/                                ← 下载文件（按平台分类）
│   └── 深渊龙宝宝(106606479711)/        ← 作者文件夹（格式：{昵称}({uid})）
│       ├── 封面/
│       │   └── 7623568275231233926_cover.jpg
│       ├── 视频/
│       │   └── 7623568275231233926.mp4
│       └── 图集/
│           └── 7623568275231233927/
│               ├── 7623568275231233927_01.jpg
│               └── 7623568275231233927.mp3
└── 快手/                                ← 快手下载文件（未来扩展）
    └── ...
```

---

## 二、核心设计原则

### 1. 职责分离

| 目录 | 用途 | 特点 |
|------|------|------|
| `.FavGallery/metadata/` | 元数据和备份数据 | 持久化存储，用于数据恢复 |
| `.FavGallery/logs/` | 运行日志 | 可定期清理 |
| `.FavGallery/resources/` | 资源文件 | 预留，暂未使用 |
| `抖音/`、`快手/` | 下载的媒体文件 | 用户主要访问的内容 |

### 2. 平台隔离

- 每个平台的数据独立存放在各自的子目录下
- 切换平台时互不影响
- 未来添加新平台只需新增对应子目录

### 3. 隐藏系统文件

- `.FavGallery` 以 `.` 开头，在大多数系统中是隐藏文件夹
- 避免干扰用户查看下载的媒体文件
- 用户主要接触的是平台文件夹（抖音/、快手/）

### 4. 避免冗余

- 同一个数据只存储一份
- `authors.js` 同时用于缓存和备份，不重复存储
- works 表按季度分片，避免单文件过大

---

## 三、详细说明

### 1. `.FavGallery/metadata/{platform}/` - 元数据和备份

#### 1.1 manifest.json
- **用途**：备份清单，记录每个数据表的哈希值和最后备份时间
- **作用**：实现增量备份，避免重复写入未变化的数据
- **结构**：
  ```json
  {
    "version": "1.0",
    "lastBackupTime": 1234567890,
    "hashes": {
      "authors": "abc123...",
      "collects": "def456...",
      "works_2024_Q1": "ghi789..."
    }
  }
  ```

#### 1.2 普通表备份文件（`{表名}.js`）
- **文件列表**：
  - `authors.js` - 作者基础信息
  - `collects.js` - 收藏夹数据
  - `author_groups.js` - 作者分组数据
  - `liked_group.js` - 点赞分组数据
  - `relations.js` - 关系数据
  - `completed_works.ndjson` - 已完成作品数据（NDJSON增量格式）

- **特点**：
  - 每个表一个文件
  - 文件格式：`.js`（序列化格式）
  - 由 `backup-manager.js` 定时备份（每 10 分钟）
  - 由 `file-system.js` 即时备份（保存数据时立即备份）

#### 1.3 设置文件（`settings.json`）
- **用途**：存储系统设置项（如侧边栏显示模式等）
- **格式**：JSON 数组，每条记录包含 `key` 和 `value`
- **示例**：
  ```json
  [
    { "key": "sidebar_mode", "value": "hover" },
    { "key": "theme", "value": "dark" }
  ]
  ```
- **特点**：
  - 由 `settings-manager.js` 管理
  - 修改后立即触发增量备份
  - 恢复时通过 `restore-manager.js` 处理

#### 1.4 缓存文件
- **文件列表**：
  - `following_status.js` - 关注状态缓存
  - `liked_works.js` - 点赞作品缓存
  - `bookmarked_works.js` - 收藏作品缓存

- **特点**：
  - 临时缓存，可随时删除重建
  - 由 `data-fetcher.js` 保存（经 `data/storage/*-manager.js` 落盘）
  - 用于降级加载（IndexedDB 无数据时从文件系统加载）

#### 1.5 works 表季度分片
- **目录结构**：`works/`
- **文件命名**：`works_{年份}_Q{季度}.json`
- **示例**：
  - `works_2024_Q1.json` - 2024年第一季度的作品
  - `works_2024_Q2.json` - 2024年第二季度的作品

- **原因**：
  - works 表数据量大，按季度分片避免单文件过大
  - 便于按需恢复某个季度的数据

### 2. `.FavGallery/logs/{platform}/` - 日志文件

- **用途**：应用运行日志
- **文件命名**：按天分文件 `{年}-{月}-{日}.log`（如 `2026-09-25.log`）
- **生成位置**：`utils/file-logger.js` 写入文件日志（`utils/logger.js` 封装调用）

### 3. `.FavGallery/resources/` - 资源文件

- **用途**：JS/CSS 等资源文件（预留，暂未使用）
- **当前状态**：空目录

### 3.1 `.FavGallery/config.json` - 用户配置文件

- **用途**：存储用户可调整的配置项（当前为各列表加载数量 `listMaxCount`）
- **生成时机**：用户首次选择文件夹后自动生成，已存在则读取
- **格式**：JSON（2 空格缩进）
- **管理模块**：`config/user-config.js`（加载/生成/合并/应用）、`data/storage/file-system.js`（读写）
- **详细设计**：见 [CONFIG_SYSTEM.md](./CONFIG_SYSTEM.md)

### 4. `{平台名称}/` - 下载文件

- **用途**：用户下载的媒体文件
- **目录层级**：平台 → 作者 → 媒体类型 → 文件
- **作者文件夹格式**：`{昵称}({uid})`
- **媒体类型文件夹**：
  - `封面/` - 封面图片
  - `视频/` - 视频文件
  - `图集/` - 图集图片和音频（图集需要单独的 workId 子文件夹）

- **文件命名规则**：
  - 封面：`{workId}_cover.jpg`
  - 视频：`{workId}.mp4`
  - 图集图片：`{workId}_{index}.jpg`（index 从 1 开始，两位补齐）
  - 图集音频：`{workId}.mp3`

---

## 四、配置项对应关系

在 `config/constants.js` 中定义的路径配置：

```javascript
FILE_SYSTEM: {
    APP_DATA_DIR: '.FavGallery',              // 应用数据根目录
    METADATA_DIR: '.FavGallery/metadata',     // 元数据存储目录
    JS_DIR: '.FavGallery/resources/js',       // JS/CSS 资源目录
    LOG_DIR: '.FavGallery/logs',              // 日志存储目录
    CONFIG_FILE: '.FavGallery/config.json'    // 用户配置文件（全局）
}
```

**注意**：实际使用时需要拼接平台名称，例如：
- 抖音的 metadata 路径：`.FavGallery/metadata/douyin/`
- 抖音的 logs 路径：`.FavGallery/logs/douyin/`

---

## 五、关键代码位置

### 1. 配置文件
- `config/constants.js` - 定义路径常量

### 2. 文件系统管理
- `data/storage/file-system.js` - 文件系统管理器，负责目录创建和文件读写
- `data/backup/backup-manager.js` - 备份管理器，负责定时备份和增量备份
- `data/backup/restore-manager.js` - 恢复管理器，负责从备份恢复数据

### 3. 列表缓存
- `content/services/data-fetcher.js` - 列表加载器，加载/合并并保存缓存（经 `data/storage/*-manager.js` 落盘）

### 4. 日志系统
- `utils/logger.js` - 日志管理器（控制台输出与封装）
- `utils/file-logger.js` - 文件日志写入

### 5. 下载文件
- `download/single-downloader.js` - 单个作品下载器，生成下载文件路径

---

## 六、常见错误

### ❌ 错误 1：硬编码路径
```javascript
// 错误
const path = 'data/.appdata/metadata/authors.js';

// 正确
const path = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/authors.js`;
```

### ❌ 错误 2：忘记按平台分类
```javascript
// 错误
const path = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/authors.js`;

// 正确
const path = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/authors.js`;
```

### ❌ 错误 3：混淆 cache 和 backup
- 当前设计中，cache 和 backup 都在 `metadata/` 目录下
- 不要创建额外的 `cache/` 或 `backup/` 子目录
- 所有文件都平铺在 `metadata/{platform}/` 下

---

## 七、未来扩展

### 1. 添加新平台（如快手）
1. 在 `metadata/` 下创建 `kuaishou/` 目录
2. 在 `logs/` 下创建 `kuaishou/` 目录
3. 在根目录下创建 `快手/` 目录用于下载文件

### 2. 日志轮转（已实现）
- 已按日期分割日志文件：`{年}-{月}-{日}.log`（`file-logger.js` 的 `getTodayLogFileName`）
- 已实现旧日志清理（超过上限时删除最旧的 `.log`）

### 3. 备份压缩
- 当前备份文件未压缩（`.js` 格式）
- 未来可以考虑压缩为 `.json.gz` 节省空间

---

## 八、版本历史

- **v1.0** (2026-04-28) - 初始版本，定义基本目录结构
  - 使用 `.FavGallery` 作为系统文件根目录
  - 按平台分类存储元数据和日志
  - works 表按季度分片
- **v1.1** (2026-09-25) - 修正过时内容
  - 代码路径更新为当前模块布局（`data/storage/`、`data/backup/`；`list-loader.js` → `data-fetcher.js`）
  - 文件日志生成位置修正为 `utils/file-logger.js`
  - 修正重复的 `#### 1.4` 编号，补全版本历史占位日期

---

**最后更新**：2026-09-25  
**维护者**：FavGallery 开发团队
