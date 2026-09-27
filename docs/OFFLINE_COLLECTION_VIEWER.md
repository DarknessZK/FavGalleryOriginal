# FavGallery 离线收藏浏览页设计文档

> **定位**：本文档描述 FavGallery 离线收藏浏览页——一个由扩展在用户本地目录自动生成、可脱离扩展双击打开的静态浏览页，用于离线浏览关注作者、点赞作品、收藏作品，并支持本地封面显示与点开本地视频文件。
>
> **状态图例**：✅ 已实现　🔜 规划中（设计已定，尚未落地）　❌ 未实现
>
> **总体状态**：✅ 数据生成器、静态壳生成器、消费端（HTML/core/index/features）、触发时机接入均已实现，序列化改为浏览器安全格式；v2.6 落地全局搜索索引与观察 C/D 修复，实机验证已于 2026-09-26 通过（分页/一键打开）；v2.8（2026-09-27）排序控件升级为多维叠加 + 交互职责分离，实机验证已通过。
>
> **最后更新**：2026-09-27（v2.8：排序升级为**多维叠加**（`state.sortOrder` + `state.sortDirs`）并拆分控件职责（方框=启用/停用、文本与箭头=升/降），方向箭头不再置灰；Tab 顺序改为 点赞→收藏夹→作者（与侧边栏一致，pane DOM 同序）；详见 8.7）  
> **此前更新**：2026-09-26（v2.7.3：全局搜索提示文案简化 + 工具栏控件统一 28px 高防切换抖动；v2.7.2：多词匹配定稿——分片内 OR / 全局 AND 固定语义仅文字提示；v2.7：搜索框多关键词小卡片（chip）；v2.6.1：全局搜索结果视图体验修正——蓝色退出钮移至筛选栏、Tab 去高亮、「📚 来自」来源标注；v2.6：全局搜索索引 `search-index.js` + 离线页跨分片检索、观察 C 封面远程回退、观察 D 图集落盘校验；v2.5：列表内分页/每页/时间筛选/跳至页输入框、顶部固定仅列表滚动布局、静态壳资源 `?v=` 缓存击穿；侧边栏新增「打开本地库」B+ 一键打开，详见 OPEN_LOCAL_LIBRARY.md；v2.4：收藏夹显示与作者计数三处修复；v2.3：入口文件更名为 `FavGallery.html`，新增首屏看门狗友好引导；v2.2：序列化改用 `serializeForBrowser` 双引号字符串字面量）

---

## 一、设计目标

1. **自动生成、无感落地**：用户在 Sidebar **选择本地文件夹**时，扩展自动在根目录生成入口页 `FavGallery.html` 及静态壳资源；数据在扩展运行期间持续刷新。用户无需点任何"导出"按钮。
2. **脱离扩展运行**：入口页是纯静态资源，双击即可在 `file://` 下浏览，扩展开着/关着/卸载都不影响——它只读磁盘上现成的数据文件。
3. **消费本地备份 + 本地媒体**：封面优先用**本地图片**，卡片可**点开本地视频文件**（相对路径已存于 `completed_works.filePath`）。
4. **跨平台多级分页**：顶级按平台分页（**仅渲染检测到有离线数据的平台**），二级按列表类型分页（点赞/作者/收藏夹）。
5. **大数据量可扩展**：面向"2000 作者 × 200 作品 = 40 万作品、5 年 18 万点赞"的量级设计，靠**三维分片 + 懒加载**把内存占用与总量解耦。
6. **下载状态自包含**：离线环境无 IndexedDB，"已保存/未保存"状态在**生成数据时**计算并固化写入。

---

## 二、核心机制：准备 / 消费分离

这是整个功能的地基，两个时刻完全独立：

| 阶段 | 发生时机 | 是否需要扩展 | 做什么 |
|------|---------|------------|--------|
| **准备** | 扩展正常运行期间（选文件夹、刷新列表、下载完成、备份） | 需要（顺带，无感） | 从 IndexedDB 全量导出 → 算下载状态 → 拼本地路径 → 分片写成 `.js` 文件 |
| **消费** | 用户任意时刻双击 `FavGallery.html` | **完全不需要** | `<script>` 加载现成数据分片 → 直接渲染 |

> **关键**：数据文件一旦落盘，离线页就自给自足。它反映的是"扩展最后一次刷新时"的快照；新下载的内容要等扩展下次运行时刷新数据文件才会出现。**浏览这个动作永远不需要扩展在场。**

---

## 三、为什么需要"准备/合并"这一步（不能直接读备份）

用户本地已有的备份文件是**三种格式**，离线页在 `file://` 下只能加载其中一种：

| 备份文件 | 格式 | 离线页能否 `<script>` 加载 |
|---------|------|--------------------------|
| `authors.js`、`relations.js`、`collects.js`、`liked_works.js`、`bookmarked_works.js` | `.js` 全局变量 | ✅ 能 |
| `works/works_2024_Q1.json` … | 分片 `.json` | ❌ 不能 |
| `completed_works.ndjson` | 逐行 NDJSON | ❌ 不能 |

`file://` 三条硬限制：**只能 `<script src>` 加载 `.js` 全局变量**、**fetch 本地文件被 CORS 拦死**、**无法动态列目录**。

而恰恰是"作品完整信息（works 分片 json）"和"下载完成记录（completed_works.ndjson）"这两块**不是可加载格式**。所以必须由扩展侧"准备"一步，做三件事：

1. **格式转换**：把 `.ndjson` / 分片 `.json` 读进来，转成可 `<script>` 加载的 `.js` 全局变量。
2. **做关联（JOIN）**：离线页没有数据库。"这个作品下载了没" = 拿 `workId` 查 `completed_works`；"这个作者下完了没" = 关联 `relations` + `completed_works` 算 `pending/partial/completed`。这些必须提前算好。
3. **固化本地路径**：把本地封面、本地视频的相对路径在生成时拼好写入。

> 一句话：**离线页能读的表里没有下载状态，有下载状态的表离线页读不了——准备步骤就是把两者拼到一起、转成能读的格式。**

---

## 四、数据量级与架构决策

### 4.1 量级测算

目标量级：2000 作者 × 200 作品 = **40 万作品**；点赞 100/天 × 5 年 ≈ **18 万条**。

| 方案 | 单条 | 总量 | 结论 |
|------|------|------|------|
| 单一合并文件（完整字段 ~1KB） | 1 KB | ~400 MB | ❌ 浏览器解析卡死/崩溃 |
| 单一合并文件（精简字段 ~350B） | 350 B | ~140 MB | ❌ 依然不可用 |

**决策：否决"单一合并文件"。** 40 万量级下，任何"一次性全量加载"的方案都不成立。

### 4.2 采纳的架构：三维分片 + 懒加载 + 自包含

- **三维分片**：按作者、按点赞时间、按收藏夹三个维度独立分片。
- **懒加载**：任何时刻只加载"当前正在看的那一片"，内存占用与总量解耦。
- **自包含分片**：每个分片自带完整展示字段，点开即渲染，**不做跨文件 JOIN、不做归一化**。

> **为什么允许重复存储（同一作品可能出现在作者片 + 点赞片 + 收藏片）**：
> ① 磁盘——媒体本身 TB 级，几百 MB 元数据重复可忽略；② 生成耗时——扩展侧一次性产出，无所谓；③ 加载——Tab 各自独立懒加载，重复不影响任何单个体量；④ **一致性——分片是每次从 IndexedDB 全量重生成的派生快照，DB 是唯一真相源，重复存储不会导致过期/不一致。** 因此自包含（允许重复）比归一化更简单、更优。

### 4.3 各维度加载体量（验证可行性）

| 场景 | 加载内容 | 大小 | 体验 |
|------|---------|------|------|
| 打开页面 | `offline-index.js` + 平台 `manifest.js` | 极小 | 秒开 |
| 作者页 | `authors/index.js`（2000 作者 × ~250B） | ~500 KB | 秒开 |
| 点进单作者 | `authors/{uid}.js`（200 作品 × ~1KB） | ~200 KB | 瞬开 |
| 点赞页首屏 | 最近 1~2 个月分片（~3000 条/月 × ~350B） | ~1-2 MB | 流畅 |
| 点赞页滚动 | 触底续加载更早月份分片 | 每片 ~1 MB | 流畅 |
| 收藏页 | 对应收藏夹分片 | 视收藏夹大小 | 流畅 |

---

## 五、目录结构（用户选择根目录后）

```
用户选择的根目录/
├── FavGallery.html                                ← ⭐ 离线浏览入口（双击打开，唯一露给用户的文件）
│
├── .FavGallery/
│   ├── config.json                            ← 用户配置（现有）
│   │
│   ├── resources/
│   │   └── offline-viewer/                    ← 静态壳资源（选文件夹时生成一次，之后不变）
│   │       ├── my-collection.css              ← 样式（拷贝自 ui/css/my-collection.css）
│   │       ├── index.js                       ← 主入口：平台/列表分页、懒加载调度
│   │       ├── core.js                        ← 数据解析、卡片渲染
│   │       └── features.js                    ← 搜索、筛选、排序、封面预览
│   │
│   └── metadata/
│       ├── offline-index.js                   ← ⭐ 跨平台清单：哪些平台有离线数据
│       ├── douyin/
│       │   ├── authors.js / relations.js / …  ← 现有备份文件（不动）
│       │   ├── works/ …                        ← 现有季度分片备份（不动）
│       │   ├── completed_works.ndjson          ← 现有（不动）
│       │   │
│       │   └── offline/                        ← ⭐ 离线浏览专用数据（每次全量重生成）
│       │       ├── manifest.js                ← 抖音分片清单（见 6.3）
│       │       ├── authors/
│       │       │   ├── index.js               ← 2000 位作者元数据列表
│       │       │   └── {uid}.js               ← 单作者全部作品（点击才加载）
│       │       ├── liked/
│       │       │   └── {yyyy_MM}.js           ← 点赞按月分片，如 2026_09.js
│       │       ├── bookmarked/
│       │       │   └── {collectId}.js         ← 按收藏夹分片
│       │       └── search-index.js             ← ⭐ 全局搜索索引（v2.6，首次全局搜索才加载）
│       │
│       └── kuaishou/offline/…                 ← 未来扩展，结构同上
│
└── 抖音/                                       ← 下载媒体（现有，离线页直接引用）
    └── {昵称}({uid})/
        ├── 封面/{workId}_cover.jpg
        ├── 视频/{workId}.mp4
        └── 图集/{workId}/…
```

### 5.1 结构要点

1. **入口 `FavGallery.html` 放根目录**：媒体相对路径最干净（`抖音/{昵称}({uid})/视频/{workId}.mp4`），也便于用户发现、双击。这是唯一露给用户看的文件；**内部所有数据/资源文件用英文小写**（遵循项目命名规范）。
2. **静态壳与数据分离**：`resources/offline-viewer/`（生成一次不变）与 `metadata/{platform}/offline/`（持续刷新）分离——数据更新不动壳，壳升级不动数据。
3. **与现有备份隔离**：离线数据全放在新的 `offline/` 子目录，**不碰**现有 `authors.js`、`works/`、`completed_works.ndjson`，职责清晰。
4. **`offline-index.js` 必需**：`file://` 无法列目录，页面靠它知道"该渲染哪几个平台"；平台内 `manifest.js` 靠它知道"有哪些点赞月份/收藏夹/作者分片"。

---

## 六、数据文件规范

### 6.1 序列化格式（浏览器安全的 `serializeForBrowser`）

所有 `.js` 数据文件由 `offline-data-generator.js` 的 `serializeForBrowser(data, varName)` 产出：

```javascript
变量名 = "{...转义后的 JSON 字符串...}";
```

即"全局变量赋值 + **双引号字符串字面量**包裹的 JSON"（双层 `JSON.stringify`：内层把数据序列化为 JSON 文本，外层把该文本转为合法 JS 字符串字面量）。离线页 `<script src>` 加载后，全局变量为 JSON 字符串，页内 `JSON.parse` 得到数据对象；扩展侧回读用配套的 `parseBrowserFile`（双层 `JSON.parse`）。这是规避 `file://` 下 ES module / fetch CORS 限制的标准做法。

> ⚠️ **为何不复用 `file-system.js` 的 `serializeData`（v2.2 修复）**：`serializeData` 用**模板字符串**（反引号）包裹，且特殊字符转义发生在 `JSON.stringify` **之前**。当数据含反引号或 `${`（如作品 `desc`）时，浏览器 `<script>` 求值模板字符串会因裸反引号提前终止而抛 `SyntaxError`，导致整片分片静默失效（`takeGlobal` 拿到 `undefined`→降级为空）。扩展侧 `deserializeData` 走"正则提取 + JSON.parse"不触发模板求值，故备份一直正常；离线页是首个用浏览器 `<script>` 加载这些 `.js` 的场景才暴露此坑。双引号字符串字面量中反引号与 `${` 无需转义，浏览器加载绝对安全；消费端 `parseGlobal`（`typeof==='string'?JSON.parse`）对两种格式天然兼容，故无需改动消费端。

### 6.2 各分片内容与全局变量名

| 文件 | 全局变量 | 内容 |
|------|---------|------|
| `metadata/offline-index.js` | `offline_index` | 平台清单：`[{platform, name, dataPath}]` |
| `offline/manifest.js` | `offline_manifest` | 分片清单：计数、点赞月份列表、收藏夹列表、作者索引指针 |
| `offline/authors/index.js` | `authors_index` | 作者元数据列表（不含作品明细） |
| `offline/authors/{uid}.js` | `author_works` | 该作者全部作品（自包含展示记录） |
| `offline/liked/{yyyy_MM}.js` | `liked_works` | 该月点赞作品（自包含展示记录，按点赞时间倒序） |
| `offline/bookmarked/{collectId}.js` | `bookmarked_works` | 该收藏夹作品（自包含展示记录） |
| `offline/search-index.js` | `search_index` | 全局搜索索引（v2.6）：跨维度 workId 去重，每行仅 `workId`+`desc`（截前 120 字）+`authorNickname`+`src` 分片定位器，按 `createTime` 倒序；首次全局搜索时懒加载 |

### 6.3 `manifest.js` 结构（懒加载的调度依据）

```javascript
// 文件实际内容：offline_manifest = "{\"platform\":\"douyin\",...}";（双引号字符串字面量）
// 下方为 JSON.parse 后的逻辑结构：
offline_manifest = {
  "platform": "douyin",
  "generatedAt": 1758500000000,
  "counts": { "authors": 2000, "liked": 182500, "bookmarked": 3400 },
  "likedMonths": ["2026_09", "2026_08", "2026_07"],   // 倒序，供滚动续加载判断
  "collects": [{ "collectId": "7234", "collectName": "我的收藏", "workCount": 123 }],
  "authorsIndex": "authors/index.js",
  "searchIndex": "search-index.js",              // 全局搜索索引指针（v2.6）
  "searchIndexCount": 186000                     // 索引去重后条目数
};
```

### 6.4 作品展示记录字段（精简自包含）

单条作品（用于卡片渲染，~350B）：

| 字段 | 说明 |
|------|------|
| `workId` | 作品 ID |
| `desc` | 描述文本（可截断） |
| `createTime` | 发布时间 |
| `authorUid` / `authorNickname` | 反规范化冗余，供卡片直接显示、免跨文件解析 |
| `isImagePost` / `mediaType` | 类型（video / image_post） |
| `statistics` | 播放/点赞/评论/分享数（可选保留） |
| `isDownloaded` | ⭐ 生成时固化（见七） |
| `localCoverPath` | ⭐ 本地封面相对路径（已下载时）：视频为 `封面/{workId}_cover.jpg`，图集为首图 `图集/{workId}/{workId}_01.jpg` |
| `localMediaPath` | ⭐ 本地视频相对路径（视频作品；图集作品无此字段，改用 `localImageDir`） |
| `localImageDir` / `imageCount` | ⭐ 图集作品：图片目录 + 张数，浏览页按 `{workId}_{01..N}.jpg` 枚举 |
| `localMusicPath` | ⭐ 图集作品本地音频 `{workId}.mp3`（仅当作品含音频且已下载） |
| `music` | 音乐元数据 `{ title, author, audioUrl }`（`audioUrl` 供本地音频缺失时回退） |
| `coverUrl` / `pageUrl` | 远程封面/页面链接（未下载时降级用） |
| `sortTime` | 点赞/收藏时间（来自 `relations.createdAt`，毫秒）；仅点赞/收藏分片带此字段 |

> **时间戳单位**：`createTime` 与 `sortTime` **均为毫秒**（`normalizeVideoData` 入库前已将发布时间转毫秒；DATABASE_SCHEMA.md 标注的“秒级”为陈旧描述）。

> **作者记录**（`authors/index.js`）字段：`uid`、`nickname`、`avatar`（本地或远程）、`followerCount`、`workCount`、`downloadStatus`、`downloadedCount`。

### 6.5 命名约束

- 术语用 `work`/`author`/`collect`，**不用** `video`/`user`/`favorite`（外部重构版的 `liked_videos.js`/`authors_base.js`/`.appdata` 路径均不采纳）。
- 字段统一驼峰：`workId`、`isDownloaded`、`isDeleted`、`createTime`。
- 文件名小写；分片日期段用下划线（`2026_09`），与现有 `works_2024_Q1.json` 风格一致。

---

## 七、下载状态固化与本地媒体

### 7.1 下载状态（生成时算死）

侧边栏运行时查 `completed_works` 实时判断；离线页做不到。生成器必须固化：

- **作品**：`isDownloaded = completed_works.has(workId)`
- **作者**：`downloadStatus: 'pending'|'partial'|'completed'` + `downloadedCount`/`workCount`，由生成器按**正确方向**（work→author 关系的作品集 ∩ completed_works）直接计算
- **作者索引收录范围（v2.2 修复）**：`authors/index.js` **仅收录有有效作品的作者**（过滤软删除后 `workRecords.length > 0`）。`authors` 表实为关注列表全部作者，多数并无已下载作品；此前无条件收录会让作者一级列表混入大量点进去为空的死链，现改为无有效作品则既不写分片文件、也不进作者索引

> ⚠️ **已知 Bug（待独立修复）**：`authors-manager.js` 的 `getAuthorDownloadStatus` 用 `source=['author',uid]` 取 `targetId` 当作品 ID，但项目实际建的是 **work→author** 关系（`sourceType:'work', targetType:'author'`），`sourceType='author'` 的关系只有 author→author_group。故该函数几乎恒返回 `pending`。**生成器不复用它**，改在 `offline-data-generator.js` 内自行正确计算；侧边栏若依赖此函数需另行修复验证。

### 7.2 本地封面 / 视频 / 图集 / 音乐

下载器的 `generate*Path` 按配置**确定性**拼路径，本地媒体路径不依赖运行时查询。关键事实：

- **视频作品**：`completed_works.filePath` 可靠（如 `抖音/{昵称}({uid})/视频/{workId}.mp4`），直接写入 `localMediaPath`；封面取同作者目录下 `封面/{workId}_cover.jpg`。
- **图集作品**：❗ `downloadImagePost` **不回传 filePath**，故 `completed_works.filePath` 为空。因此图集的封面/图片/音乐路径**均按配置重建**（`resolveLocalBaseDir` 回退分支）：先定位作者目录 `{平台名}/{昵称}({uid})`，再拼 `图集/{workId}/`。封面 = 首图 `{workId}_01.jpg`，音乐 = `{workId}.mp3`（仅当 `work.music.audioUrl` 存在）。
- **作者目录解析**：优先用 `filePath` 前两段（视频，下载时固化、作者改名后仍准）；filePath 为空时按 `PLATFORM_INFO[platform].name` + `sanitizeForFileSystem(昵称)` + `uid` 重建（图集）。
- **卡片行为**：封面 `<img src=localCoverPath>`（已下载）或 `coverUrl`（未下载降级）；视频卡片链接指向 `localMediaPath`；图集按 `localImageDir` + `imageCount` 枚举；音乐用 `<audio src=localMusicPath>`，加载失败时回退 `music.audioUrl`。
- **路径基准**：所有媒体路径相对于**根目录**（即 `FavGallery.html` 所在处），保证 `<img>`/`<a>`/`<audio>` 在 DOM 中正确解析。

> 实现：`offline-record-builder.js` 的 `resolveLocalBaseDir` + `deriveLocalPaths`，规则与 `download/single-downloader.js` 的 `generateVideoPath`/`generateCoverPath`/`generateImagePath`/`generateMusicPath` 一致。

### 7.3 已知低优先级观察（✅ v2.6 已修复）

以下为第二轮链路排查发现的边缘体验点，均已于 2026-09-26 修复：

- **C｜已下载作品封面无远程回退** → ✅ 已修复（`core.js`）：卡片封面与放大预览图片模式下，本地封面加载失败时 `onerror` 先回退到记录中的远程 `coverUrl`（仅尝试一次，防死循环），仍失败才置灰。联网时体验完整，断网时自然落到置灰。
- **D｜图集张数取自 `work.images.length`** → ✅ 已修复（`core.js` 预览端）：打开图集查看器时并行探测全部图（`probeImages`），裂图从可切换列表剔除，计数器显示「x / M（N 张缺失）」；全部缺失时提示本地文件不存在。生成器侧不扫盘（重 I/O 且破坏纯函数设计），运行时探测更准确。
  - 注：卡片角标「图集 N」仍为平台记录总数（真实期望值）；实际落盘数以预览时探测为准。

---

## 八、页面结构与交互

### 8.1 多级分页

```
平台分页（仅渲染有离线数据的平台；单平台时不显示此栏，直接进二级）
   └── 列表类型分页：点赞（默认） / 收藏夹 / 作者（v2.8 调序，与侧边栏一致；Tab 按钮与 pane DOM 同序，`switchTab` 按 `data-tab`/id 取元素，换序无需改 JS）
          └── 作者页可再点进单作者，浏览其全部作品
```

- 默认路径：**抖音 → 点赞**
- 平台栏**优雅降级**：`offline-index.js` 只有一个平台时不渲染平台切换栏，避免顶部孤零零一个不可切的标签；≥2 个平台时才显示

### 8.2 懒加载调度

- **打开页面**：加载 `offline-index.js` → 当前平台 `manifest.js`
- **点赞页**：按 `likedMonths` 倒序，首屏加载最近 1~2 个月；滚动触底时动态注入下一个月的 `<script>`
- **作者页**：加载 `authors/index.js`；点击某作者时动态注入 `authors/{uid}.js`
- **收藏页**：加载 `manifest.js` 中的 `collects` 清单；选中收藏夹时注入 `bookmarked/{collectId}.js`
- 动态注入方式：`document.createElement('script')` + 设 `src` 指向本地分片（`file://` 下可行，区别于被拦截的 fetch/module）

### 8.3 DOM 结构（对应现有 CSS 类名）

- 头部 `.header`（标题 + 副标题）
- 加载态 `#loading` + `.spinner`；错误容器 `#errorContainer`
- 主内容 `#content`
  - 平台栏（条件渲染）
  - 搜索框 `#searchInput`
  - 筛选/排序工具栏 `.filter-sort-toolbar`（筛选：全部/已保存/未保存；排序：时间/保存状态 可叠加，各带方向切换，见 8.7）
  - 列表类型 Tab 导航 `.tab-nav`（点赞/收藏夹/作者，各带计数）
  - Tab 内容 `.tab-content`（各含 `.list` + `.empty-state`）
- 封面悬浮预览 `#coverHoverPreview`

### 8.4 搜索策略（✅ v2.6 全局搜索已实现；v2.7 多关键词小卡片）

- **多关键词 chip 式搜索框**（v2.7）：搜索框改为带边框容器 `.search-box`（内含 `#searchChips` + 无边框 input，`display:contents` 同流布局）；输入后按**回车或逗号**固化为蓝底小卡片 `.search-chip`（含「×」单独移除，空输入退格删最后一个，重复词去重）；逗号叠加对中文/英文逗号均生效，且不依赖按键拦截——input 通道检测输入值中的逗号（输入法上字、粘贴路径均覆盖），keydown 仅兜底直接键入时阻止逗号落入输入框；状态模型：`state.keywords`（已固化数组）+ `state.keyword`（正在输入文本），生效词 = 两者拼接（`activeKeywords()`），**词间关系固定不分场景开关**（v2.7.2 终稿）：**分片内永远 OR**（命中任意词即显示，浏览扩召回手感好）/ **全局搜索永远 AND**（需命中全部词——跨 40 万量级库精确检索，OR 会命中爆炸撞 300 上限）；取舍理由：两种场景诉求天然不同，不给用户选择只给提示——空态灰字浅说「全局搜索需要所有关键词都匹配，首次需加载索引，稍慢」（v2.7.3 简化，不再描述分片内 OR），全局结果条标注「需命中全部关键词」；涉及收藏夹名/作者名/作品描述昵称的过滤均同此语义；退出全局搜索（clearKeyword）时清空小卡片；样式参照侧边栏收藏夹多选交互
- **分片内搜索**：数据已加载，直接过滤（描述/作者昵称，大小写不敏感）
- **跨分片全局搜索**（v2.6 已落地，采纳原方案一「独立精简索引」）：
  - 生成端：`_generateSearchIndex` 输出 `offline/search-index.js`（workId 去重，维度优先级 点赞>收藏>作者，`src` 定位器 `l:月份`/`b:collectId`/`a:uid`，desc 截前 120 字）
  - 消费端（`index.js`）：**任一 Tab**（点赞/作者/收藏夹，含一级列表）范围内 0 命中且有关键词时，空状态出现「🔍 全局搜索整个库」入口（v2.6.1 起不再限作品视图，避免误解为只搜点赞）→ 首次点击懒加载索引（同会话缓存，切平台失效）→ 匹配 desc/昵称（上限 300 条）→ 按 `src` 分组按需加载命中分片取回完整展示记录（含本地媒体路径）→ 结果走既有筛选/排序/分页管线；改关键词/切 Tab/进二级视图自动退回范围搜索
  - **结果视图（v2.6.1 体验修正）**：全局结果不再伪装成当前 Tab 的列表——① 二级视图栏显示「🌐 全局搜索 · “词” · N 条结果」，「← 返回」即退出；② 三个 Tab 按钮全部去高亮，退出后恢复；③ 筛选组「未保存」右侧蓝底白字「✕ 退出全局搜索」按钮（`.global-exit-btn`，动态插入，仅全局模式显示）；④ 每张结果卡 meta 行由 `srcLabel(src)` 生成来源标注（「📚 来自 收藏「xx」」/「📚 来自 点赞 · 2026年09月」/「📚 来自 作者 · xx」），随记录副本携带，不污染分片缓存
  - 已知取舍：全局匹配仅覆盖 desc 前 120 字（尾部命中靠分片内搜索）；命中上限 300 条

### 8.5 容错

- `<script>` 加载失败/数据缺失：若干秒后 `#loading` 仍可见 → 判定数据未生成，展示期望目录树提示用户先在扩展中选择文件夹

### 8.6 列表内分页与筛选（仅作品视图，v2.5 已实现）

作用于**作品视图**（点赞 / 作者详情 / 收藏夹详情，`isWorksView()` 为 true）；作者/收藏夹一级列表全量显示、分页条隐藏。

- **分页条 `#pager`**（位于工具栏右侧，顺序：时间 | 每页 | 分页 | 排序）：计数「共 N 条 · 第 x/y 页」+ 首页/上一页/下一页/末页 + **跳至输入框**（`.pager-jump-input`：回车/失焦跳转，页码夹取到 `[1, totalPages]`，跳转后清空输入，隐藏 number 上下微调按钮）
- **每页数量 `#pageSizeSelect`**：默认 60（`DEFAULT_PAGE_SIZE`）
- **时间筛选 `#dateFrom`/`#dateTo`/`#dateClear`**：按 `createTime` 日期范围过滤，空=不限
- **状态**：`state.currentPage`/`state.pageSize`/`state.dateFrom`/`state.dateTo` 入统一 state；切 Tab、进出二级视图、筛选/排序/搜索变化均回到第 1 页；页码越界自动夹取
- **翻页滚动**：`goToPage` 重渲染后将列表滚动容器 `.tab-content` 平滑滚回顶部（非 window）
- **布局**：头部/平台栏/二级视图栏/搜索/工具栏/Tab 导航全部固定在滚动容器之外，**仅列表 `.tab-content` 滚动**
- 样式：`ui/css/my-collection.css` 的 `.pager`/`.pager-btn`/`.pager-jump` 系列

### 8.7 排序：多维叠加与职责分离（v2.8，2026-09-27）

作用于**作品视图**（点赞/作者详情/收藏夹详情，含全局搜索结果）；作者一级列表走 `filterAuthors()`。

- **状态模型**（`ui/local/index.js` 的 `state`，两个字段均为唯一真源）：
  - `sortOrder: ['time']` —— 已启用的排序维度，**按勾选顺序定优先级**（先选为主键，后选追加为次级键）；空数组 = 不排序（靠 `Array.sort` 稳定性保留生成顺序）
  - `sortDirs: { time: 'desc', status: 'desc' }` —— 各维度的升/降设定，**未启用也保留**（可预先调好方向，启用即生效）
  - 默认视图即 `sortOrder=['time']` + `time:'desc'`（`isDefaultView()` 据此判定是否显示「共 N 条」类默认文案）
- **控件职责分离**（`.sort-section`，每维度一行：方框 + `.sort-text` + `.sort-direction` 箭头）：
  - 左侧**方框**（`#sortByTime`/`#sortByStatus`）：只管启用/停用（启用→追加到 `sortOrder` 末尾；停用→仅从 `sortOrder` 移除）
  - 选项**文本**（`#sortTextTime`/`#sortTextStatus`）与右侧**箭头**（`#dirTime`/`#dirStatus`）：只翻转该维度的升/降序，**不改启用状态**
  - HTML 不再用 `<label class="sort-item">` 包裹整行（否则点文本会被浏览器转发成切换 checkbox），改 `span` + 裸 checkbox；CSS 相应取消 `.sort-item` 整块 `cursor:pointer`，`.sort-text` 单独给手型与悬停高亮
- **UI 反推**：`syncSortUI()` 一律由 `sortOrder`/`sortDirs` 覆写勾选、箭头字符（↑/↓）与 title（展示「主键 / 第 N 优先级 / 未启用」）；**箭头按钮不再 `disabled`**——已启用维度文本与箭头一同高亮
  > 旧实现（双复选框互斥）的永久置灰 bug：取消时间时把箭头 `disabled=true`、互斥分支又关掉对方箭头，回落时无人恢复。现由“state 单向反推 UI”结构性消除
- **比较实现**（`ui/local/features.js`）：`sortLevels(state)` 把 `sortOrder` 映射为 `{key,dir}` 层级数组；`compareWorks()` 逐级比较，`sign = dir==='asc' ? 1 : -1`，时间取 `sortTime || createTime`，保存状态取 `isDownloaded`；**status 为该维的最后一个层级时补同向时间次级键**（布尔二值比较在全同状态时否则无可见变化）；`filterAuthors()` 取 `sortLevels` 中首个 status 层级，按 `downloadStatus` 三档聚合（时间层级对作者一级列表无意义，保持关注顺序）
- **生效链路**：改 `ui/html/my-collection.html`/`ui/css/my-collection.css`/`ui/local/*.js` 后需**重载扩展 → 重新点一次「选择文件夹」**（`offline-shell-generator.js` 全量覆盖并加 `?v=` 时间戳）→ 刷新离线页

---

## 九、模块分工

| 模块 | 位置 | 职责 |
|------|------|------|
| 入口/协调 | `ui/local/index.js` → 生成到 `resources/offline-viewer/index.js` | 平台/列表分页切换、懒加载调度、协调 core/features |
| 核心渲染 | `ui/local/core.js` | `JSON.parse` 全局变量、卡片 HTML 生成、列表渲染 |
| 增强功能 | `ui/local/features.js` | 搜索、筛选、多维排序、封面悬浮预览 |
| 数据生成器 | 新建（建议 `data/export/` 或 `content/services/`） | 从 IndexedDB 全量导出 → 算状态 → 拼路径 → 分片写 `.js` |
| 静态壳生成 | 新建（选文件夹流程调用） | 拷贝 HTML/CSS/JS 到 `resources/offline-viewer/` + 根目录 `FavGallery.html` |

---

## 十、生成流程

```
用户在 Sidebar 选择本地文件夹
        │
        ├──▶ A. 生成静态壳（一次性，异步不阻塞）
        │      ├── 根目录写 FavGallery.html（源自 ui/html/my-collection.html）
        │      └── resources/offline-viewer/ 写 css + index/core/features.js
        │
        └──▶ B. 准备离线数据（选文件夹时首次 + 运行时持续全量刷新）
               1. 读 IndexedDB：works / authors / relations / collects / completed_works
               2. 算下载状态（作品 isDownloaded；作者 downloadStatus）
               3. 拼本地路径（localCoverPath / localMediaPath）
               4. 过滤 isDeleted=true 的失效记录
               5. 三维分片 + 全局搜索索引：
                  - authors/index.js + authors/{uid}.js
                  - liked/{yyyy_MM}.js（按 relations.createdAt 月份分组）
                  - bookmarked/{collectId}.js
                  - search-index.js（跨维度 workId 去重，v2.6）
               6. serializeForBrowser 序列化为 .js 全局变量（双引号字符串字面量）
               7. 写 manifest.js（分片清单）+ metadata/offline-index.js（平台清单）
```

> **路径约束**：所有路径走 `CONFIG.FILE_SYSTEM` / `DOWNLOAD_CONFIG.fileSystem` 常量拼接，**禁止硬编码**（见 FILE_SYSTEM_STRUCTURE.md「常见错误 1」）。

> **静态壳资源缓存击穿（v2.5）**：`offline-shell-generator.js` 写入口 HTML 时给其引用的静态壳资源（CSS/JS）相对路径追加 `?v=<时间戳>`，每次重新「选择文件夹」全量覆盖生成后自动击穿浏览器对 `file://` 旧 JS/CSS 的强缓存，消除"改了扩展代码但离线页不更新"问题。

---

## 十一、命名与架构约束

| # | 约束 | 说明 |
|---|------|------|
| 1 | 路径不硬编码 | 走 `CONFIG.FILE_SYSTEM`；离线数据在 `metadata/{platform}/offline/` |
| 2 | 入口文件名 | 用户可见入口用 `FavGallery.html`；内部文件英文小写 |
| 3 | 术语命名 | `work`/`author`/`collect`，不用 `video`/`user`/`favorite` |
| 4 | 字段命名 | 驼峰 `workId`/`isDownloaded`/`isDeleted`/`createTime` |
| 5 | 下载状态生成时固化 | 离线无 IndexedDB，状态写进数据文件（见七） |
| 6 | 非模块脚本 | `file://` 不支持 ES module，`offline-viewer/*.js` 须为经典脚本或打包 bundle |
| 7 | 软删除过滤 | 生成时剔除 `isDeleted=true`，离线页只呈现有效数据 |
| 8 | 自包含分片 | 每片自带展示字段，不做跨文件 JOIN / 归一化（见 4.2） |
| 9 | 平台感知 | 仅渲染有离线数据的平台；单平台时隐藏平台栏 |
| 10 | web_accessible_resources | `data/export/*.js`（被 main.js 静态 import）及静态壳源文件（`ui/html/my-collection.html`、`ui/css/my-collection.css`、`ui/local/*.js`，被 fetch 读取）**必须声明于 manifest.json**；否则 main world 的 module import / fetch 会被拦截，导致整个 content module 加载失败 |

---

## 十二、现状盘点与待实现清单

### 12.1 现状

| 组成 | 路径 | 状态 |
|------|------|------|
| 样式表 | `ui/css/my-collection.css` | ✅ 已实现（533 行，全套样式） |
| 页面结构 | `ui/html/my-collection.html` | ✅ 已实现（多级分页/懒加载容器/预览层 + 内联补充样式） |
| 主入口 | `ui/local/index.js` | ✅ 已实现（平台/列表分页、懒加载调度，经典脚本 IIFE） |
| 核心模块 | `ui/local/core.js` | ✅ 已实现（解析全局变量、卡片渲染、本地媒体预览） |
| 增强模块 | `ui/local/features.js` | ✅ 已实现（搜索/筛选/排序/封面悬浮预览） |
| 序列化格式 | `data/export/offline-data-generator.js` → `serializeForBrowser` / `parseBrowserFile` | ✅ 浏览器安全格式（v2.2 起不再复用 `serializeData`，见 6.1） |
| 渲染参考 | `utils/work-list-manager.js` | ✅ 可参考（需改非模块） |
| 数据生成器 | `data/export/offline-data-generator.js`、`offline-record-builder.js` | ✅ 已实现并接入触发时机 |
| 静态壳生成器 | `data/export/offline-shell-generator.js` | ✅ 已实现（选文件夹时 fetch 扩展源→写用户目录） |

### 12.2 待实现

| 项 | 文件/位置 | 状态 |
|----|----------|------|
| 页面结构（含多级分页、懒加载容器） | `ui/html/my-collection.html` | ✅ 已实现 |
| 入口/协调/懒加载调度 | `ui/local/index.js` | ✅ 已实现 |
| 解析/渲染 | `ui/local/core.js` | ✅ 已实现 |
| 搜索/筛选/排序/预览 | `ui/local/features.js` | ✅ 已实现 |
| 离线数据生成器（三维分片） | `data/export/offline-data-generator.js` + `offline-record-builder.js` | ✅ 已实现并接入 |
| 静态壳生成器（选文件夹时调用） | `data/export/offline-shell-generator.js` | ✅ 已实现并接入 |
| 生成触发时机接入 | 选文件夹 / 批量下载完成 / 作者下载完成 | ✅ 已接入（异步不阻塞 + 并发保护） |
| JS 打包/加载策略 | 按序经典脚本（IIFE 挂 window.Local*） | ✅ 已定：无需打包 |
| 全局搜索索引（增强项） | 生成端 `offline-data-generator.js` → `_generateSearchIndex`；消费端 `ui/local/index.js` → `runGlobalSearch` | ✅ 已实现（v2.6，待实机验证） |
| 已下载封面远程回退（观察 C） | `ui/local/core.js` → `renderWorkCard` / `openPreview` | ✅ 已修复（v2.6，onerror 回退远程一次） |
| 图集张数与实际落盘对齐（观察 D） | `ui/local/core.js` → `probeImages`（预览时运行时探测） | ✅ 已修复（v2.6，裂图剔除+缺失提示） |
| 实机验证 | 重载扩展→选文件夹→双击 `FavGallery.html` | ✅ 2026-09-26 已验证（分页/一键打开）；v2.6 新增项待验证 |

---

## 十三、源文件 → 产物映射

| 扩展内源文件（模板） | 生成到用户文件夹 |
|------|------|
| `ui/html/my-collection.html` | `FavGallery.html`（根目录） |
| `ui/css/my-collection.css` | `.FavGallery/resources/offline-viewer/my-collection.css` |
| `ui/local/index.js` | `.FavGallery/resources/offline-viewer/index.js` |
| `ui/local/core.js` | `.FavGallery/resources/offline-viewer/core.js` |
| `ui/local/features.js` | `.FavGallery/resources/offline-viewer/features.js` |
| （无源，运行时从 IndexedDB 生成） | `.FavGallery/metadata/{platform}/offline/**` 全部分片 |
| （无源，运行时生成） | `.FavGallery/metadata/offline-index.js` |

---

## 十四、关键代码位置索引

| 功能 | 文件 |
|------|------|
| 序列化工具（离线分片） | `data/export/offline-data-generator.js` → `serializeForBrowser` / `parseBrowserFile`（浏览器安全，见 6.1） |
| 序列化工具（备份，勿混用） | `data/storage/file-system.js` → `serializeData` / `deserializeData`（模板字符串格式，仅扩展侧正则回读） |
| 作者下载状态计算 | `data/storage/authors-manager.js` → `getAuthorDownloadStatus`（⚠️ 方向 Bug，生成器未复用，见 7.1） |
| 作品/作者加载逻辑 | `data/storage/works-manager.js`、`authors-manager.js` |
| 下载记录字段（filePath 来源） | `download/batch-download-manager.js`、`completed_works` 表 |
| 备份分片/序列化参考 | `data/backup/backup-manager.js` |
| 路径/命名常量 | `config/constants.js` → `FILE_SYSTEM`、`DOWNLOAD_CONFIG.fileSystem`、`PLATFORM_INFO` |
| 渲染/搜索参考 | `utils/work-list-manager.js` |
| 页面样式（已实现） | `ui/css/my-collection.css` |
| 页面/脚本脚手架 | `ui/html/my-collection.html`、`ui/local/{index,core,features}.js` |

---

## 十五、版本历史

- **v2.7.3**（2026-09-26）搜索提示文案简化与工具栏防抖动：空态全局搜索提示改为一句「全局搜索需要所有关键词都匹配，首次需加载索引，稍慢」（去掉分片内 OR 描述）；工具栏控件（date-input/pagesize-select/pager-btn/pager-jump-input/date-clear）统一固定 28px 高——date 输入框内在高度比其他控件大，切 Tab 时时间筛选区显隐会顶高整行产生抖动，固定后行高恒定（`#globalSearchBtn` 除外）
- **v2.7.2**（2026-09-26）多词匹配语义定稿：去掉 v2.7.1 的用户开关（`#matchModeSelect` 删除），改为固定场景语义——分片内永远 OR、全局搜索永远 AND，仅在空态说明与结果条给文字提示；理由：范围浏览要扩召回、跨库精搜要收窄，天然不同，选择框反而增加认知负担
- **v2.7.1**（2026-09-26）多词匹配关系开关：搜索框右侧新增 `#matchModeSelect`（匹配任意词 OR 默认 / 匹配全部词 AND），统一作用于分片内过滤与全局搜索；全局结果态切换自动重搜；背景：OR 在全库搜索下命中爆炸被 300 上限截断，精确检索需 AND 能力（已被 v2.7.2 替代）
- **v2.7**（2026-09-26）搜索框多关键词小卡片化（见 8.4）：回车/逗号固化 chip、可单独删/退格回删，多词 **OR 命中**（同日按用户预期从 AND 改为 OR，中/英文逗号经 input 通道检测均可叠加），分片内与全局搜索同一语义；涉及 `ui/html/my-collection.html` + `ui/css/my-collection.css` + `ui/local/{index,features}.js`，需重选文件夹刷新静态壳生效
- **v2.6.1**（2026-09-26）全局搜索结果视图体验修正（见 8.4）：退出按钮从分页条移到筛选「未保存」右侧并改蓝底白字醒目样式；二级视图栏明示「🌐 全局搜索」结果标题（返回即退出）；全局模式下 Tab 高亮清除；结果卡新增「📚 来自 xx」来源标注，解决“收藏夹作品显示在点赞列表里”的语义错乱感；全局搜索入口放开到三个 Tab（含作者/收藏夹一级列表 0 命中）。仅涉及 `ui/local/{index,core}.js` + `ui/css/my-collection.css`，需重选文件夹刷新静态壳生效
- **v2.6**（2026-09-26）全局搜索索引 + 观察 C/D 修复（三项增强收口）：
  - **全局搜索**：生成器新增 `_generateSearchIndex` 输出 `offline/search-index.js`（workId 去重、维度优先级 点赞>收藏>作者、`src` 定位器、desc 截 120 字）；manifest 新增 `searchIndex`/`searchIndexCount`。离线页作品视图 0 命中时空态出现「🔍 全局搜索整个库」，首次懒加载索引后匹配→按 src 分组加载命中分片取全记录（上限 300）→走既有筛选/排序/分页管线，分页条带退出按钮（见 8.4）
  - **观察 C 修复**：已下载作品本地封面加载失败时回退远程 `coverUrl`（卡片与放大预览均支持，仅一次防死循环）
  - **观察 D 修复**：图集预览打开时 `probeImages` 并行探测实际落盘张数，裂图从切换列表剔除、计数器显示缺失数，全部缺失时明确提示
  - **同日确认**：v2.5 实机验证通过（列表内分页/跳页/一键打开本地库均正常）
  - 生效：需重载扩展→重选文件夹（触发含 search-index 的数据重生成）→重开 `FavGallery.html`
- **v2.5**（2026-09-26）浏览体验批量优化 + 侧边栏一键打开本地库：
  - **列表内分页与筛选**（见 8.6）：分页条（计数 + 首/上/下/末页）、每页数量选择器（默认 60）、时间范围筛选、**「跳至 [__] 页」输入框**（回车/失焦跳转、越界夹取、隐藏 number spinner）；仅作品视图显示，一级列表隐藏
  - **布局**：顶部固定（头部/工具栏/Tab 均在滚动容器外），仅 `.tab-content` 列表区滚动；翻页后列表滚回顶部
  - **静态壳 `?v=` 缓存击穿**：入口 HTML 引用资源追加时间戳 query，重选文件夹即拉新（见十）
  - **离线页细节修正**（同批）：Tab 计数改为「已下载/总数」双维徽标 + 悬浮说明；作者/作品卡片 tooltip 收尾
  - **侧边栏「📂 打开本地库」B+ 自动捕获**：`tabs.onUpdated`/`query` 反查已打开的 `file:///…/FavGallery.html` 标签页 URL 自动记住绝对路径，一键聚焦/打开；manifest 加 `tabs` 权限，background 承担捕获+打开+探测，event-binder 点击先开后引导；另含跨域 iframe 剪贴板 `execCommand` 兜底（后随「复制文件名」按钮一同移除，见 OPEN_LOCAL_LIBRARY.md v1.1）。完整机制、前置条件与已否决方案见 **[OPEN_LOCAL_LIBRARY.md](./OPEN_LOCAL_LIBRARY.md)**
  - 生效：侧边栏/后台改动仅需重载扩展；离线页改动需重载→重选文件夹→重开 `FavGallery.html`
- **v2.4**（2026-09-25）收藏夹显示与作者计数三处修复：
  - **修复 1（收藏夹名为空 → “未命名收藏夹”、作品数为 0）**：`data/storage/works-manager.js` 的 `saveBookmarkedWorks` 原用 `database.save('collects', {collectId, workCount, lastUpdate})` 更新收藏夹元数据；因 `database.save` 底层是 IndexedDB `put()`（整体覆盖），仅传部分字段会抹掉原有 `collectName`/`isDeleted`/`sortOrder`，导致离线页读到空名回退显示“未命名收藏夹”、数量错乱。改为先 `database.get('collects', collectId)` 取回原记录再展开合并保留字段
  - **修复 2（侧边栏作者卡片“已存 X/Y 作品”不刷新）**：`core/author-download-manager.js` 的 `finishAuthorDownload` 下载完成后仅更新 `.download-btn` 按钮与复选框，卡片中独立的统计行 DOM 未刷新，停留在旧值（如 0/8，DB 已正确持久化，仅重载列表才更新）。为统计行包裹 `span.author-saved-count`（`utils/author-card-renderer.js`），新增 `updateAuthorSavedCount(uid, downloadedCount, workCount)` 并在持久化前调用，实现实时刷新
  - **修复 3（附带，断点续传判断失效）**：`data/storage/authors-manager.js` 的 `getAuthorDownloadStatus` 原用 `getByIndex('relations','source',['author',uid])` + `map(r=>r.targetId)`，查询方向反（命中的是 author→author_group 关系），`downloadedCount` 恒为 0、`downloadStatus` 恒 `pending`。改为 `target` 索引 + `filter(r=>r.sourceType==='work')` + `map(r=>r.sourceId)`
  - 生效前提：需重载扩展并重新选文件夹触发离线数据重生成；已被抹名的 `collects` 记录需重新加载一次该收藏夹作品才会恢复名称。离线页收藏夹作品数仅对“已在扩展中加载过作品的收藏夹”非 0，从未打开过的收藏夹无关系数据显示 0 属预期
- **v2.3**（2026-09-23）入口更名与首屏友好引导：
  - 入口文件由 `本地库.html` 更名为 **`FavGallery.html`**（`OFFLINE_ENTRY_HTML` 常量），页面 `<title>`/`<h1>` 同步改为 FavGallery，相关注释与文档一并统一
  - **首屏看门狗**：`my-collection.html` 内联一段不依赖外部 JS 的超时引导（默认 6s），当静态壳/离线数据缺失（首次使用未选文件夹、或选完后台仍在生成）导致外部 JS 加载失败、`#loading` 无限转圈时，强制展示友好的首次使用引导；`index.js` 的 `showNoDataGuide` 复用同一文案（`window.__favGalleryGuideHtml`），并修复 `!core` 时早退导致卡死的问题
- **v2.2**（2026-09-23）序列化安全修复与第二轮链路排查：
  - **修复 A（阻断性）**：离线分片序列化由 `file-system.serializeData`（模板字符串）改为 `offline-data-generator.js` 内的 `serializeForBrowser`（双层 `JSON.stringify` → 双引号字符串字面量）；配套新增 `parseBrowserFile`（双层 `JSON.parse`）供扩展侧回读 `offline-index`。原因见 6.1：数据含反引号/`${` 时模板字符串在浏览器 `<script>` 求值下会 `SyntaxError` 致分片静默失效。消费端 `parseGlobal` 与备份 `serializeData/deserializeData` 均不改动
  - **修复 B（决策违背）**：`_generateAuthors` 的作者索引改为**仅收录有有效作品的作者**（`workRecords.length > 0` 才 `push`），避免作者一级列表混入点击为空的死链（见 7.1）
  - 记录两项低优先级观察 C（封面远程回退）/ D（图集张数对齐）于 7.3，暂不修复
  - 第二轮排查确认正常：下载器↔记录构建器路径对齐、`completed_works.mediaType` 可靠、消费端相对路径解析、`extensionOrigin` 兜底、manifest `web_accessible_resources` 完整、触发时机（restore 已 await 后再生成 + 并发守卫）
- **v2.1**（2026-09-22）消费端与生成落地：
  - 实现 `my-collection.html` + `ui/local/{core,index,features}.js`（经典脚本 IIFE，挂 `window.Local*`）
  - 实现静态壳生成器 `data/export/offline-shell-generator.js`（`fetch(chrome-extension://…)` 读扩展源 → 写用户目录）
  - 接入触发时机：选文件夹（静态壳 + 数据）、批量下载完成、作者下载完成（均异步不阻塞，生成器内含并发保护）
  - 修复遗漏：`data/export/*.js` 与静态壳源文件补入 manifest `web_accessible_resources`（否则 main world import/fetch 被拦）
- **v2.0**（2026-09-22）重大重构：
  - 否决"手动导出按钮 + 单一合并文件"旧设想
  - 改为**选文件夹自动生成 + 运行时持续刷新**的准备/消费分离机制
  - 面向 40 万作品量级，采纳**三维分片（作者/点赞按月/收藏夹）+ 懒加载 + 自包含分片**
  - 新增**平台多级分页**（仅渲染有数据的平台，单平台隐藏平台栏）
  - 入口定名 `FavGallery.html`（根目录）；新增 `offline-index.js` / `manifest.js` 清单机制
  - 明确本地封面 + 点开本地视频（复用 `completed_works.filePath`）
- **v1.0**（2026-09-21）初始版本：脚手架盘点 + 单一合并文件设想（已被 v2.0 取代）

---

**维护者**：FavGallery 开发团队
