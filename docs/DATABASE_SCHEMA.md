# FavGallery 数据库设计文档

## 📋 目录

- [1. 文档概述](#1-文档概述)
- [2. 数据库整体架构](#2-数据库整体架构)
- [3. 数据表详细设计](#3-数据表详细设计)
- [4. 枚举类型说明](#4-枚举类型说明)
- [5. 关系模型设计原理](#5-关系模型设计原理)
- [6. 数据流转图](#6-数据流转图)
- [7. 版本历史](#7-版本历史)

---

## 1. 文档概述

### 1.1 设计目标

本文档描述 FavGallery 项目的本地数据存储架构，包括：
- IndexedDB 数据库表结构设计
- 文件系统备份策略
- 数据关系模型设计
- 字段命名规范和枚举值定义

**当前数据表列表（9张）：**
1. works - 作品元数据
2. relations - 通用关系表
3. authors - 作者列表
4. collects - 收藏夹列表
5. completed_works - 已完成下载
6. liked_group - 点赞分组元数据
7. author_groups - 作者分组元数据
8. collect_groups - 收藏夹分组元数据
9. settings - 系统配置

### 1.2 适用范围

- 适用于 FavGallery v1.0 及后续版本
- 涵盖抖音平台的数据存储（预留多平台扩展能力）
- 包含作品、作者、收藏夹、关系等核心数据的存储规范

### 1.3 设计原则

1. **通用化抽象** - 避免平台特定术语（如 workId 而非 awemeId）
2. **最小冗余** - 可推导的状态不单独存储
3. **软删除机制** - 重要实体保留删除标记而非物理删除
4. **计数缓存** - 频繁查询的计数单独缓存以提升性能
5. **关系统一管理** - 使用单一 relations 表管理所有实体间关系

---

## 2. 数据库整体架构

### 2.1 双层存储架构

IndexedDB (主存储)
- 实时读写
- 8 张核心数据表
- 支持索引和复杂查询
  ↓ 定期备份
  文件系统 (备用存储)
- 按季度分片存储 works 表
- 完整备份其他表
- gzip 压缩优化存储空间
- 哈希对比实现增量备份

### 2.2 存储策略

**IndexedDB：**
- 作为主要数据存储，提供实时读写能力
- 支持复杂查询和索引优化
- 浏览器关闭后数据持久化

**文件系统备份：**
- 作为灾难恢复的备用方案
- works 表按 createTime 季度分片（如 works_2024_Q1.json.gz）
- 其他小表完整备份（authors.json、collects.json 等）
- 定时备份 + 事件触发备份（列表加载、下载完成）

### 2.3 数据库配置

**数据库版本：** 1
**对象存储数量：** 9 张表

**数据库名称（v1.1 起按账号动态命名，不再是固定名）：**

| 场景 | 库名 | 说明 |
|------|------|------|
| 已绑定抖音账号 | `FavGallery_<uid>` | `uid` 为页面直取的当前登录账号纯数字 uid |
| 未绑定账号（默认态） | `FavGallery_guest` | 兜底库，仅存全局偏好（如 `sidebar_mode`）；业务读写受守卫拦截，不落兜底库 |

- **实现位置**：`utils/account-context.js#buildDbName` 生成库名；`data/database/database.js#useAccount(uid)` 在 `selectFolder` 流程里被调用（早于 `fileSystem.init()`，避免多余开一次兜底库），只改名不重新开库，真正的打开由现有 `_transaction → init()` 自动完成
- **隔离目的**：与本地文件系统的账号数据区子目录（见 [FILE_SYSTEM_STRUCTURE.md](./FILE_SYSTEM_STRUCTURE.md) 1.1）同步隔离，避免同一浏览器 Profile 下切换抖音账号后，新账号读到旧账号的 IndexedDB 数据
- **不做旧库兼容/迁移**：项目未上线，历史上固定名为 `FavGallery` 的旧库无需处理，开发机直接删除重建即可

---

## 3. 数据表详细设计

### 表 1：works（作品元数据）

**用途：** 存储所有作品的完整元数据信息（视频、图集等）

**主键：** workId（字符串）

**索引：**
- author.uid（非唯一，用于按作者查询作品）
- createTime（非唯一，用于按时间范围查询和季度分片）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| workId | string | 是 | 作品唯一标识符 |
| desc | string | 是 | 作品描述文本 |
| createTime | number | 是 | 发布时间（秒级时间戳） |
| author | object | 是 | 作者信息（嵌套对象） |
| author.uid | string | 是 | 作者UID |
| author.platformId | string | 是 | 平台加密ID |
| author.nickname | string | 是 | 作者昵称 |
| statistics | object | 是 | 统计数据（嵌套对象） |
| statistics.playCount | number | 是 | 播放数 |
| statistics.likeCount | number | 是 | 点赞数 |
| statistics.commentCount | number | 是 | 评论数 |
| statistics.shareCount | number | 是 | 分享数 |
| video | object | 否 | 视频信息（仅视频类型有值） |
| video.pageUrl | string | 否 | 作品页面跳转链接 |
| video.coverUrl | string | 否 | 封面图片URL |
| video.duration | number | 否 | 视频时长（毫秒） |
| video.width | number | 否 | 视频宽度（像素） |
| video.height | number | 否 | 视频高度（像素） |
| images | array | 否 | 图集图片URL列表（仅图集类型有值） |
| isImagePost | boolean | 是 | 是否为图集类型 |
| music | object | 是 | 音乐信息（嵌套对象） |
| music.title | string | 是 | 音乐标题 |
| music.author | string | 是 | 音乐作者 |
| music.audioUrl | string | 是 | 音频URL |
| isDeleted | boolean | 是 | 软删除标记（默认 false）；平台侧取消点赞/移出收藏夹后由 `_mergeItems` 标记为 true |

**示例数据：**
{
workId: "7234567890",
desc: "这是一个测试视频",
createTime: 1713801600,
author: {
uid: "106606479711",
platformId: "MS4wLjABAAAA...",
nickname: "深渊龙宝宝"
},
statistics: {
playCount: 123456,
likeCount: 7890,
commentCount: 456,
shareCount: 123
},
video: {
pageUrl: "https://www.douyin.com/video/7234567890",
coverUrl: "https://p.douyin.com/xxx.jpg",
duration: 15000,
width: 1080,
height: 1920
},
images: null,
isImagePost: false,
music: {
title: "背景音乐",
author: "歌手",
audioUrl: "https://sf.douyin.com/xxx.mp3"
},
isDeleted: false
}

**设计说明：**
- 采用嵌套结构保持与 API 返回数据的一致性
- video 和 images 字段互斥（视频类型 video 有值，图集类型 images 有值）
- createTime 使用秒级时间戳，便于按季度分片备份
- author 嵌套对象只存储必要字段，完整作者信息存储在 authors 表
- isDeleted 支持软删除：平台侧取消点赞/移出收藏夹后，刷新列表时由 `_mergeItems` 标记，不物理删除记录
- **话题标签（`#xxx`）不单列字段、不单独存表**：作品描述 `desc` 里的抖音话题（如 `#英文翻唱 #女生翻唱`）100% 可从 `desc` 派生，按“最小冗余”原则不在 works 落库。需要时在消费端用正则从 `desc` 实时提取为 `topics: string[]`（侧边栏筛选）；离线页因无 IndexedDB，在生成展示记录（`data/export/offline-record-builder.js#buildWorkRecord`）时把提取结果固化进 `topics` 字段，属**消费侧派生缓存**，不改变主库结构。列表接口不含结构化话题；`aweme_detail.text_extra`（精确话题）仅单作品详情接口返回，MVP 不依赖它
- **`video.play_addr` 为瞬态字段、落库前主动剥离（故本表不文档化该列）**：归一化 `_extractVideo`（`utils/platform-helpers.js`）会从平台 `play_addr`/`bit_rate` 提取带签名的临时直链放入 `video.play_addr.url_list[0]`，但 `data/storage/works-manager.js#_sanitizeWorkForStorage` 在 `save('works')` 前 `delete sanitized.video.play_addr`——因为抖音直链会过期且绑 UA/Referer/防盗链，持久化无意义。下载链路（`download/single-downloader.js#downloadVideo`）每次都从**实时获取的作品详情**现取 `play_addr`、不读库内该字段；离线页 `buildWorkRecord` 亦不带上它。因此离线页只能播放“已下载到本地”的媒体属合理边界（签名直链既过期又需联网，无法用于离线回放）

---

### 表 2：relations（通用关系表）

**用途：** 统一管理所有实体间的多对多关系，支持灵活扩展

**主键：** id（自增数字，IndexedDB 自动生成）

**索引：**
- [sourceType, sourceId]（复合索引，非唯一，用于查询某实体的所有出边关系）
- [targetType, targetId]（复合索引，非唯一，用于查询某实体的所有入边关系）
- [sourceType, sourceId, targetType, targetId]（复合索引，唯一，防止重复关系）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | number | 是 | 自增主键（IndexedDB 自动生成） |
| sourceType | string | 是 | 来源实体类型（见枚举说明） |
| sourceId | string | 是 | 来源实体ID |
| targetType | string | 是 | 目标实体类型（见枚举说明） |
| targetId | string | 是 | 目标实体ID |
| createdAt | number | 是 | 关系创建时间戳（毫秒级） |

**示例数据：**

示例 1：作品属于作者
{
id: 1,
sourceType: "work",
sourceId: "7234567890",
targetType: "author",
targetId: "106606479711",
createdAt: 1713801600000
}
// 含义：作品 7234567890 归属于作者 106606479711

示例 2：作者属于关注分组
{
id: 2,
sourceType: "author",
sourceId: "106606479711",
targetType: "author_group",
targetId: "group_default",
createdAt: 1713801600000
}
// 含义：作者 106606479711 归属于关注分组 group_default

示例 3：作品在收藏夹中
{
id: 3,
sourceType: "work",
sourceId: "7234567890",
targetType: "collect",
targetId: "collect_123",
createdAt: 1713801600000
}
// 含义：作品 7234567890 在收藏夹 collect_123 中

示例 4：作品在点赞列表中
{
id: 4,
sourceType: "work",
sourceId: "7234567890",
targetType: "liked_group",
targetId: "liked",
createdAt: 1713801600000
}
// 含义：作品 7234567890 在点赞列表 liked 中

**设计说明：**
- 采用四字段设计（sourceType、sourceId、targetType、targetId）实现通用关系模型
- 支持任意实体类型的多对多关系，无需为每种关系创建独立表
- 唯一索引防止同一关系被重复插入
- 不存储 extra 字段，遵循最小化原则，未来需要时通过数据库升级添加
- **删除策略（仅机制一 · 平台驱动软删除）**：
  - **机制一 · 平台驱动软删除（已实现）**：平台侧取消点赞/取关/移出收藏夹后，刷新列表时给**实体**（works/authors/collects）打 `isDeleted=true`，relations 边保持不变（只插入不删除），以便追溯与恢复。
  - **机制二 · 用户主动本地删除（已废弃，v2026-09-29）**：曾预留“界面删除已下载作品 → `removeRelation` 物理删对应关系边 + 同步删 `completed_works` 单条”。经评估废弃——用户只会物理删除本地文件，不会精准清理 completed_works 某一条；即便误删整表也有备份还原兜底，且本地文件从不从库还原、库也从不从本地文件还原，两侧互不污染、基本不会出问题。“删了本地想再补回”的真实场景已由**校验补全**（见 FEATURE_COMPLETENESS.md 第 40 条）覆盖。据此删除 `data/database/relation-manager.js` 的预留件 `hasRelation`（Grep 确认无任何调用方的死代码）。
  - 注：relations 表**不设 isDeleted 字段**；"失效关系"语义由实体表的 isDeleted 承载。

---

### 表 3：authors（作者列表）

**用途：** 存储作者的完整信息和统计数据

**主键：** uid（字符串）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| uid | string | 是 | 作者UID（主键） |
| platformId | string | 是 | 平台加密ID |
| nickname | string | 是 | 作者昵称 |
| avatarUrl | string | 是 | 头像URL |
| followingCount | number | 是 | 关注数 |
| followerCount | number | 是 | 粉丝数 |
| workCount | number | 是 | 已知作品总数（分母，缓存字段，口径见下方设计说明） |
| downloadedCount | number | 是 | 已下载作品数（缓存字段，默认 0） |
| isDeleted | boolean | 是 | 软删除标记（默认 false）；确认取关后置 true，条目保留、仅禁止继续下载 |
| unfollowedAt | number | 否 | 确认取关的时间戳（毫秒级），仅 `isDeleted=true` 时写入 |
| unfollowReason | string | 否 | 判定依据文本（默认“下载前关注状态单点校验”），落库以便事后核对 |
| lastCheckedTime | number | 否 | 最近一次确认/核对该作者状态的时间戳（毫秒级）；纯审计字段，当前只在取关标记事务内写入，详见下方设计说明 |

**示例数据：**
{
uid: "106606479711",
platformId: "MS4wLjABAAAA...",
nickname: "深渊龙宝宝",
avatarUrl: "https://p.douyin.com/avatar/xxx.jpg",
followingCount: 683,
followerCount: 33,
workCount: 9,
downloadedCount: 5,
isDeleted: false
}

**设计说明：**
- **workCount（分母）口径——单调不减**：一旦真正拉取过该作者的作品清单（`relations` 表有条目），分母完全由本地全集统计（关系表去重条数）决定，不再参与平台返回的作者作品计数（`apiWorkCount`）——因为作者删作品时平台计数会回落，如果直接覆盖会造成分母倒退、甚至出现分子（已下载数）大于分母的倒挂；只有从未拉取过清单时（新关注、本地无任何关系条目），才退化为用 `max(本地缓存值, 平台计数)` 作为估计值。实现：`utils/author-completion.js#computeKnownWorkCount`、`resolveMergedWorkCount`
- **完成态不禁用按钮**：`已下载数 == 已知作品总数` 不代表“作者没有新作品”（作者发新作品时本地分母还来不及跟上），因此完成态仍允许点击/勾选，按钮文案为“检查更新”，靠真实拉一次清单求差集来发现新作品。实现：`utils/author-completion.js#resolveAuthorAction`
- isDeleted 支持机制一平台驱动软删除（详见本文档「表 2：relations」设计说明里的删除策略——仅机制一，机制二已于 v2026-09-29 废弃），确认取关时不物理删除记录，仅禁下载；写入入口唯一合法来源为 `data/storage/authors-manager.js#markAuthorsUnfollowed`（必须整条合并写回，不能只传部分字段，否则 `save` 的 put 语义会丢失昵称/头像等基础数据）；是否有权判定“已取关”的准入门槛见下方 5.6 软删除授权策略
- **`unfollowedAt`/`unfollowReason`/`lastCheckedTime` 均为纯审计字段**：全仓库无任何代码读取它们（不展示在侧边栏、不参与离线页逻辑、不做判断依据），仅供人工排查数据库/备份文件时核对。`lastCheckedTime` 不需要接入全量刷新链路（不接是有意决定，不是遗漏）：软删除判定用的是“本轮命中/未命中清单”的集合成员关系（见 5.6），不依赖时间戳比较；真正生效的列表刷新合并逻辑是 `content/services/data-fetcher.js#_mergeItems`，不写这个字段。历史上 `utils/helpers.js` 里曾有一套看似“通用刷新都会打 lastCheckedTime”的 `mergeDataWithCache`/`mergeWorkData`，经排查为全仓库零调用的死代码（与 `_mergeItems` 重复实现），已于 2026-09-28 删除

---

### 表 4：collects（收藏夹列表）

**用途：** 存储收藏夹的元数据和统计信息

**主键：** collectId（字符串）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| collectId | string | 是 | 收藏夹ID（主键） |
| collectName | string | 是 | 收藏夹名称 |
| workCount | number | 是 | 作品数量（缓存字段） |
| isDeleted | boolean | 是 | 软删除标记（默认 false） |
| sortOrder | number | 是 | 排序顺序（默认 0） |

**示例数据：**
{
collectId: "7234567890",
collectName: "我的收藏",
workCount: 123,
isDeleted: false,
sortOrder: 0
}

**设计说明：**
- workCount 为缓存字段，提升列表展示性能
- sortOrder 支持用户自定义排序
- isDeleted 支持软删除，删除收藏夹时不物理删除记录

---

### 表 5：completed_works（已完成下载）

**用途：** 记录已下载到本地文件系统的作品信息，用于断点续传和跳过重复下载

**主键：** workId（字符串）

**索引：**
- downloadTime（非唯一，用于按下载时间查询）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| workId | string | 是 | 作品ID（主键） |
| downloadTime | number | 是 | 下载完成时间戳（毫秒级） |
| filePath | string | 是 | 文件相对路径（相对于用户选择的根目录） |
| fileSize | number | 是 | 文件大小（字节） |
| mediaType | string | 是 | 媒体类型（见枚举说明） |
| quality | string | 否 | 画质等级（见枚举说明） |

**示例数据：**
{
workId: "7234567890",
downloadTime: 1713801600000,
filePath: "抖音/深渊龙宝宝(106606479711)/视频/7234567890.mp4",
fileSize: 12345678,
mediaType: "video",
quality: "1080p"
}

**设计说明：**
- 不需要 status 字段，因为此表本身就只记录已完成的作品
- filePath 使用相对路径，便于用户更换根目录后仍然有效
- mediaType 区分视频和图集，用于文件类型判断
- quality 记录下载时的画质选择，可选字段

---

### 表 6：liked_group（点赞分组元数据）

**用途：** 存储点赞列表的元数据（特殊分组，固定成员）

**主键：** groupId（字符串，固定为 "liked"）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| groupId | string | 是 | 分组ID（固定为 "liked"） |
| groupName | string | 是 | 显示名称（"点赞"） |
| icon | string | 是 | 图标 emoji（"❤️"） |
| workCount | number | 是 | 作品数量（缓存字段） |

**示例数据：**
{
groupId: "liked",
groupName: "点赞",
icon: "❤️",
workCount: 1234
}

**设计说明：**
- liked 是特殊分组，包含点赞和特别推荐两个子项
- workCount 为缓存字段，通过 relations 表统计更新
- 此表主要用于 UI 展示

---

### 表 7：author_groups（作者分组元数据）

**用途：** 存储用户自定义的作者分组信息

**主键：** groupId（字符串）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| groupId | string | 是 | 分组ID（主键） |
| groupName | string | 是 | 分组名称 |
| description | string | 否 | 分组描述 |
| sortOrder | number | 是 | 排序顺序（默认 0） |
| isDeleted | boolean | 是 | 软删除标记（默认 false） |
| authorCount | number | 是 | 作者数量（缓存字段） |

**示例数据：**
{
groupId: "group_default",
groupName: "默认分组",
description: "",
sortOrder: 0,
isDeleted: false,
authorCount: 234
}

**设计说明：**
- authorCount 为缓存字段，通过 relations 表统计更新
- sortOrder 支持用户自定义排序
- isDeleted 支持软删除，删除分组时不物理删除记录

---

### 表 8：collect_groups（收藏夹分组元数据）

**用途：** 存储用户自定义的收藏夹分组信息

**主键：** groupId（字符串）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| groupId | string | 是 | 分组ID（主键） |
| groupName | string | 是 | 分组名称 |
| description | string | 否 | 分组描述 |
| sortOrder | number | 是 | 排序顺序（默认 0） |
| isDeleted | boolean | 是 | 软删除标记（默认 false） |
| collectCount | number | 是 | 收藏夹数量（缓存字段） |

**示例数据：**
```
{
    groupId: "DouYin_collects",
    groupName: "默认分组",
    description: "",
    sortOrder: 0,
    isDeleted: false,
    collectCount: 5
}
```

**设计说明：**
- groupId 采用 `平台_分组ID` 格式（如 `DouYin_following`），支持多平台扩展
- collectCount 为缓存字段，通过 relations 表统计更新
- sortOrder 支持用户自定义排序
- isDeleted 支持软删除，删除分组时不物理删除记录
- 参照 author_groups 设计，用于管理收藏夹分组

---

### 表 9：settings（系统配置）

**用途：** 存储用户自定义的系统配置（键值对存储）

**主键：** key（字符串）

**字段定义：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| key | string | 是 | 配置键（主键） |
| value | any | 是 | 配置值（任意类型） |

**已知使用的 key：**

| key | 说明 |
|------|------|
| `sidebar_mode` | 侧边栏展示模式（全局偏好，未绑定账号时写入兜底库 `FavGallery_guest`） |
| `account_binding` | 当前数据库所属账号的绑定记录：`{ uid, nickname, folderName, boundAt }`，`selectFolder` 成功后 fire-and-forget 写入对应账号库 |

**示例数据：**
{
key: "theme",
value: "dark"
}

**设计说明：**
- 当前未使用，配置存储在 constants.js 中
- 预留用于未来用户自定义配置功能
- value 可以是字符串、数字、对象等任意类型

---

## 4. 枚举类型说明

### 4.1 sourceType（来源实体类型）

| 枚举值 | 说明 | 示例 |
|--------|------|------|
| work | 作品 | 视频、图集等内容 |
| author | 作者 | 创作者账号 |
| collect | 收藏夹 | 用户创建的收藏夹 |

### 4.2 targetType（目标实体类型）

| 枚举值 | 说明 | 示例 |
|--------|------|------|
| author | 作者 | 作品归属于作者 |
| collect | 收藏夹 | 作品在收藏夹中 |
| liked_group | 点赞分组 | 作品在点赞列表中 |
| author_group | 作者分组 | 作者在关注分组中 |
| collect_group | 收藏夹分组 | 收藏夹在分组中 |

### 4.3 mediaType（媒体类型）

| 枚举值 | 说明 | 文件扩展名 |
|--------|------|-----------|
| video | 视频 | .mp4 |
| image_post | 图集 | .jpg（多张图片） |

### 4.4 quality（画质等级）

| 枚举值 | 说明 | 适用场景 |
|--------|------|---------|
| 1080p | 1080P 高清 | 视频下载 |
| 720p | 720P 标清 | 视频下载 |
| origin | 原始画质 | 视频/图片下载 |
| large | 大图 | 封面/头像下载 |

### 4.5 FOLLOW_STATE（关注状态三态判定，下载链路专用）

用于 `api/douyin/api.js#getAuthorFollowStatus`：下载前对单个作者做关注状态单点取证（不依赖关注清单完整性），解析实现见 `utils/follow-verification.js#parseFollowState`。

| 枚举值 | 说明 | 对应处理 |
|--------|------|---------|
| following | `follow_status = 1`，确认仍关注 | 正常下载 |
| unfollowed | `follow_status = 0`，确认已取关 | 触发机制一软删除（`markAuthorsUnfollowed`） |
| unknown | 请求失败 / 字段缺失 / 取值不在已知枚举内 | **不拦截、不改判**：照常下载且不下软删除结论，绝不允许走到 `markAuthorsUnfollowed` |

> 三态原则：宁可漏判不可误判。“拿不到结论”不能当成“已取关”，否则一旦接口抽风就会把一堆正常关注的作者误标为失效。

---

## 5. 关系模型设计原理

### 5.1 为什么使用通用关系表？

**传统设计的局限性：**
- 为每种关系创建独立表（如 author_works、collect_works）
- 新增关系类型需要修改数据库结构
- 查询逻辑分散，维护成本高

**通用关系表的优势：**
1. **高度灵活** - 新增关系类型无需修改表结构，只需插入新记录
2. **统一管理** - 所有关系在一个地方，便于维护和备份
3. **可扩展性强** - 支持未来新增实体类型（如标签、话题等）
4. **避免冗余** - 不需要为每种关系创建独立表和索引

### 5.2 关系查询示例

**查询某作者所有作品：**
const relations = await database.getByIndex(
'relations',
'target',
['author', '106606479711']
);
const workIds = relations.map(r => r.sourceId);

**查询某收藏夹的所有作品：**
const relations = await database.getByIndex(
'relations',
'target',
['collect', 'collect_123']
);
const workIds = relations.map(r => r.sourceId);

**查询某作品属于哪些收藏夹：**
const relations = await database.getByIndex(
'relations',
'source',
['work', '7234567890']
);
const collectIds = relations
.filter(r => r.targetType === 'collect')
.map(r => r.targetId);

### 5.3 关系建立时机

**列表加载时：**
- 保存作品到 works 表
- 同时建立 作品→作者 关系
- 如果是点赞列表，建立 作品→liked_group 关系
- 如果是收藏列表，建立 作品→collect 关系

**下载完成后：**
- 记录到 completed_works 表
- 不需要建立新的关系（关系已在列表加载时建立）

---

### 5.4 各业务场景数据表使用说明

#### **关注列表（following）**

| 操作 | 使用的数据表 | 环节说明 |
|------|------------|----------|
| 刷新列表 | authors, author_groups, relations | 保存作者元数据，创建默认分组，建立 author→author_group 关系 |
| 单个作者下载 | completed_works, works, relations | 查询已下载作品，保存作品元数据，建立 work→author 关系，标记完成 |
| 批量下载（多个作者） | completed_works, works, relations | 同单个下载，循环处理多个作者 |

**详细说明：**

1. **刷新列表**
   - `authors` 表：保存作者基本信息（uid、昵称、头像等）
   - `author_groups` 表：创建或更新默认分组（如 `douyin_following`）
   - `relations` 表：建立 `author → author_group` 关系，将作者归属到分组

2. **单个/批量作者下载**
   - `completed_works` 表（读）：查询该作者已下载的作品ID，实现断点续传
   - `works` 表：保存获取到的作品元数据
   - `relations` 表：建立 `work → author` 关系，记录作品归属
   - `completed_works` 表（写）：每个作品下载成功后标记为已完成

---

#### **点赞列表（liked）**

| 操作 | 使用的数据表 | 环节说明 |
|------|------------|----------|
| 刷新列表 | works, liked_group, relations | 保存作品元数据，创建默认分组，建立 work→liked_group 关系 |
| 单个/批量下载 | completed_works | 查询已下载 + 标记完成 |

**详细说明：**

1. **刷新列表**
   - `works` 表：保存点赞作品的元数据
   - `liked_group` 表：创建或更新默认分组（固定为 `liked`）
   - `relations` 表：建立 `work → liked_group` 关系，将作品归属到点赞列表

2. **单个/批量下载**
   - `completed_works` 表（读）：查询已下载的作品ID，跳过重复下载
   - `completed_works` 表（写）：下载成功后记录文件路径、大小等信息

---

#### **收藏列表（bookmarked）**

| 操作 | 使用的数据表 | 环节说明 |
|------|------------|----------|
| 刷新列表（加载收藏夹） | collects, collect_groups, relations | 保存收藏夹元数据，创建默认分组，建立 collect→collect_group 关系 |
| 选中收藏夹加载作品 | works, relations | 保存作品元数据，建立 work→collect 关系 |
| 单个/批量下载 | completed_works | 查询已下载 + 标记完成 |

**详细说明：**

1. **刷新列表（加载收藏夹元数据）**
   - `collects` 表：保存收藏夹基本信息（collectId、名称、作品数等）
   - `collect_groups` 表：创建或更新默认分组（如 `douyin_collects`）
   - `relations` 表：建立 `collect → collect_group` 关系，将收藏夹归属到分组

2. **选中收藏夹加载作品**
   - `works` 表：保存该收藏夹内作品的元数据
   - `relations` 表：建立 `work → collect` 关系，记录作品属于哪个收藏夹

3. **单个/批量下载**
   - `completed_works` 表（读）：查询已下载的作品ID，跳过重复下载
   - `completed_works` 表（写）：下载成功后记录文件路径、大小等信息

---

### 5.5 数据表使用总结

**核心规律：**

1. **刷新列表**：保存元数据 + 建立关系
   - 关注列表：authors + author_groups + relations
   - 点赞列表：works + liked_group + relations
   - 收藏列表：collects + collect_groups + works + relations

2. **下载操作**：只操作 completed_works 表
   - 读取：查询已下载作品ID（断点续传）
   - 写入：标记作品下载完成

3. **关注列表特殊**：批量下载时需要额外建立 work→author 关系

**注意事项：**
- 所有列表的下载操作都只依赖 `completed_works` 表，不涉及其他表的读写
- 关系只在列表加载时建立，下载时不修改关系
- 软删除机制：取消关注、删除收藏夹等操作只标记 `isDeleted`，不物理删除

---

### 5.6 软删除授权策略（机制一的准入门槛）

软删除是“平台驱动”的结论——只有当我们确实在本轮看到了**完整清单**时，才有资格说“某条目不在清单里 = 用户取消了它”。任何失败、截断、未到底的情况，一律视为“本轮没检测到变化”，绝不下删除结论（宁可漏检，不可误删；误删会让已保存的本地内容从离线页成批消失）。

**刷新列表链路（批量判定的前提）：**判定本轮是否有权对“本轮 API 窗口之外”的缓存条目标记 `isDeleted`，证据三要素（实现：`utils/soft-delete-policy.js#resolveSoftDeletePolicy`）：

| 证据 | 为真/为假时的含义 |
|------|-------------------|
| `partial === true` | 本轮存在重试耗尽仍失败的情况，清单不可信 → **拒绝授权** |
| `apiItemCount === 0` | 本轮一条都没拿到，空结果不能作为“全部已取消”的证据（接口异常同样表现为空）→ **拒绝授权** |
| `sawEnd !== true` | 未确认到底（被 `maxCount` 截断或提前停止），只看到了窗口，不能对窗口外下结论 → **拒绝授权** |
| 三者均通过 | 已确认清单到底 → 放行，`applyOutOfWindowDisposition` 把窗口外条目设为 `isDeleted: true`（拒绝授权时原样保留既有状态，既不下新结论也不撤销旧结论） |

**下载链路（单点取证）：**不依赖上述批量证据，改为下载前对单个作者调 `getAuthorFollowStatus`（见 4.5 FOLLOW_STATE）拿实时结论，只有明确为 `unfollowed` 才触发 `markAuthorsUnfollowed`；`unknown` 不影响下载、不下判定。

---

### 5.7 标签体系存储决策（设计备忘，未实现代码）

标签分**两类**，职责与存储策略完全不同（背景：侧边栏=下载作品，离线浏览页=管理已下载作品；“管理”语义的标签均归离线页）：

| 类型 | 来源 | 读写 | 是否存表 | 落点 |
|------|------|------|---------|------|
| **话题标签** | `desc` 里的 `#xxx`，创作者自加 | 只读、可派生 | **不存表、不加字段** | 消费端从 `desc` 提取（见【表 1 works】设计说明）；离线页展示/筛选 |
| **自定义标签** | 用户自建分类（待看/素材等） | 可写、不可派生 | **未来新增 `tags` 表 + 复用 `relations`** | 写落扩展侧主库（唯一真实来源），离线页只读 |

- **话题标签（优先实现）**：纯派生、零回写，放离线页几乎不增加复杂度（生成时固化 `topics` + 筛选加一维）。
- **自定义标签（优先度极低，未来单独排期）**：需持久化。届时新增一张轻量 `tags` 表承载标签本体（`tagId`/`name`/`color`/`isDeleted`），作品↔标签的多对多复用现有 **relations** 通用关系表（`sourceType='work'`、`targetType='tag'`），与 5.1 预留一致。
- **为何不自定义标签也放离线页写**：离线页是 file:// 静态页，无 IndexedDB、无回写通道，字段均为生成时从主库固化。在离线页内直接编辑会触发架构级改动（本地持久化 + 回传主库 + 防重生成覆盖），故定“扩展写、离线页读”。

---

## 6. 数据流转图

### 6.1 列表加载流程

用户点击"刷新列表"
↓
API 请求获取作品数据
↓
数据标准化（normalizeVideoData）
↓
保存到 IndexedDB works 表
↓
建立关系记录（relations 表）
↓
异步备份到文件系统
↓
UI 更新显示

### 6.2 下载流程

用户点击"下载"
↓
从 relations 表获取作品ID列表
↓
从 works 表批量获取作品详情
↓
检查 completed_works 表（跳过已下载）
↓
逐个下载作品到文件系统
↓
记录到 completed_works 表
↓
达到阈值时触发备份（10条或1分钟）
↓
UI 更新进度

### 6.3 备份流程

定时触发（每小时）或事件触发
↓
从 IndexedDB 读取所有表数据
↓
works 表按 createTime 季度分片
↓
gzip 压缩大表（works、relations）
↓
计算哈希值（增量检测）
↓
写入文件系统备份文件
↓
更新备份元数据

---

## 7. 版本历史

### v1.0（2024-04-21）

**初始版本，包含以下设计决策：**

1. **9 张核心数据表**
    - works：作品元数据（嵌套结构）
    - relations：通用关系表（四字段设计）
    - authors：作者列表（含软删除）
    - collects：收藏夹列表（含排序）
    - completed_works：下载记录（相对路径）
    - liked_group：点赞分组元数据
    - author_groups：作者分组元数据
    - collect_groups：收藏夹分组元数据
    - settings：系统配置（预留）

2. **命名规范**
    - 字段统一驼峰命名（camelCase）
    - 表名保持下划线风格（snake_case）
    - 通用化抽象（workId 替代 awemeId，platformId 替代 secUid）

3. **关系模型**
    - 采用通用关系表设计
    - 支持任意实体类型的多对多关系
    - 唯一索引防止重复关系

4. **下载记录**
    - completed_works 表只记录已完成的作品
    - 使用相对路径存储 filePath
    - 包含 mediaType 和 quality 字段

5. **软删除机制**
    - authors、collects、author_groups、collect_groups 表添加 isDeleted 字段
    - 取消操作时不物理删除记录

6. **计数缓存**
    - workCount、authorCount、collectCount 等频繁查询的计数字段单独缓存
    - 通过 relations 表统计更新

7. **收藏夹分组**
    - 新增 collect_groups 表管理收藏夹分组
    - 支持 collect → collect_group 关系
    - 参照 author_groups 设计模式

**设计原则：**
- 最小冗余：可推导的状态不单独存储
- 通用化：避免平台特定术语
- 可扩展：支持未来新增实体类型和关系类型

---

### v1.1（2026-09-28）

**本轮变更（账号隔离 + 软删除口径完善）：**

1. **数据库名称按账号动态化**（见 2.3）：从固定名 `FavGallery` 改为 `FavGallery_<uid>`（已绑定）/ `FavGallery_guest`（未绑定兜底），与文件系统的账号数据区子目录（`FavGallery(昵称)[uid]`）同步隔离；不做旧库兼容/迁移
2. **settings 表新增已知 key**：`account_binding`（账号绑定记录）、`sidebar_mode`（全局偏好，写入兜底库）
3. **authors 表新增字段**：`unfollowedAt`、`unfollowReason`、`lastCheckedTime`（仅在确认取关触发 `markAuthorsUnfollowed` 时与 `isDeleted` 同一事务写入）
4. **workCount 口径重写**：明确为“已知作品总数（分母），单调不减”，与平台计数的关系仅保留在“从未拉取过清单”的兜底场景（见 3.表 3、`utils/author-completion.js`）
5. **新增 4.5 FOLLOW_STATE 枚举**：下载链路单点取证的三态判定（following/unfollowed/unknown），unknown 绝不触发软删除
6. **新增 5.6 软删除授权策略**：刷新链路的批量判定必须先满足 `sawEnd && !partial && apiItemCount>0` 三个证据，否则不得对窗口外条目下结论（`utils/soft-delete-policy.js`）

---

### v1.2（2026-09-29）

**本轮变更（标签体系设计备忘，未实现代码）：**

1. 明确“话题标签不单独存表/不加字段”，由 `desc` 派生（见【表 1 works】设计说明）；消费端（侧边栏筛选/离线页）实时提取 `topics`。
2. 新增 5.7 标签体系存储决策：话题标签只读派生优先做、放离线页；自定义标签未来用 `tags` 表 + 复用 `relations`，扩展写、离线页读，优先度极低单独排期。
3. 记录职责划分：侧边栏=下载作品，离线页=管理已下载作品。

---

文档结束
