# FavGallery 架构设计文档

## 📋 目录

- [1. 项目概述](#1-项目概述)
- [2. 技术栈](#2-技术栈)
- [3. 目录结构](#3-目录结构)
- [4. 分层架构](#4-分层架构)
- [5. 核心模块](#5-核心模块)
- [6. 数据流图](#6-数据流图)
- [7. 设计决策](#7-设计决策)

---

## 1. 项目概述

### 1.1 项目定位

FavGallery 是一个跨平台社交内容备份管理工具，帮助用户管理和备份个人在社交平台（抖音、小红书等）上的收藏内容，防止数据丢失。

### 1.2 核心功能

- ✅ 多平台支持（抖音已实现，其他平台可扩展）
- ✅ 关注列表管理
- ✅ 点赞作品列表管理
- ✅ 收藏夹管理
- ✅ 作品下载（视频、图集、封面）
- ✅ 数据备份与恢复（按季度分片存储）
- ✅ 增量同步（哈希对比避免重复备份）

---

## 2. 技术栈

### 2.1 核心技术

- **Chrome Extension Manifest V3** - Service Worker 架构
- **IndexedDB** - 本地数据库存储
- **File System Access API** - 文件系统操作
- **ES6 Modules** - 模块化开发

### 2.2 主要 API

- `chrome.storage` - 扩展存储
- `chrome.runtime` - 运行时通信
- `chrome.tabs` - 标签页管理
- `crypto.subtle.digest` - 哈希计算

---

## 3. 目录结构
FavGallery/ 
├── api/ # API 层（平台适配） 
│ ├── douyin/ # 抖音平台实现 
│ │ ├── api.js # 抖音 API 实现 
│ │ ├── config.js # 抖音配置 
│ │ └── helpers.js # 抖音辅助函数 
│ └── platform-adapter.js # 平台适配器（统一接口） 
│ 
├── config/ # 配置层 
│ └── constants.js # 全局常量配置 
│ 
├── content/ # Content Script 层 
│ ├── services/ # 服务层 
│ │ ├── data-fetcher.js # 数据获取服务（原 list-loader.js）
│ │ └── download-service.js # 下载服务（预留） 
│ ├── index.js # 入口文件 
│ └── main.js # 主逻辑 
│ 
├── core/ # 核心业务逻辑层 
│ ├── app.js # 应用主控制器 
│ ├── author-download-manager.js # 作者下载管理 
│ ├── batch-selection-manager.js # 批量选择管理器
│ ├── batch-download-manager.js # 批量下载管理 
│ ├── collects-download-manager.js # 收藏夹下载管理 
│ ├── collects-feature-manager.js # 收藏夹功能管理 
│ ├── event-binder.js # 事件绑定器
│ ├── file-system.js # 文件系统协调器（已废弃，保留兼容） 
│ ├── list-display-manager.js # 列表显示管理器 ⭐ 新增
│ └── message-handler.js # 消息处理器 
│ 
├── data/ # 数据层（持久化） 
│ ├── database.js # IndexedDB 封装 
│ ├── file-system.js # 文件系统操作 
│ ├── backup-manager.js # 备份管理器 ⭐ 新增 
│ └── relation-manager.js # 关系表管理 
│ 
├── storage/ # 存储层 
│ └── database.js # 数据库初始化（已合并到 data/database.js） 
│ 
├── download/ # 下载模块 
│ ├── page-downloader.js # 页面下载器 
│ └── single-downloader.js # 单个作品下载器 
│ 
├── ui/ # UI 层 
│ ├── css/ # 样式文件 
│ ├── html/ # HTML 模板 
│ ├── local/ # 本地页面（预留） 
│ ├── tab-manager.js # Tab 管理器 
│ └── ui-state-manager.js # UI 状态管理器 
│ 
├── utils/ # 工具函数层 
│ ├── helpers.js # 通用辅助函数 
│ ├── logger.js # 日志系统 
│ ├── path-helpers.js # 路径处理 
│ ├── platform-helpers.js # 平台通用辅助 
│ ├── ui-helpers.js # UI 辅助函数 
│ ├── work-helpers.js # 作品辅助函数 
│ └── work-list-manager.js # 作品列表管理 
│ 
├── background.js # Service Worker 入口 
└── manifest.json # 扩展配置文件

---

## 4. 分层架构
┌─────────────────────────────────────────┐ 
│ UI Layer (UI 层) │ 
│ - sidebar.html/css │ 
│ - tab-manager.js │ 
│ - ui-state-manager.js │ 
└──────────────┬──────────────────────────┘ 
               │ 
┌──────────────▼──────────────────────────┐ 
│ Core Layer (核心业务层) │ │ - app.js (主控制器)
│ 
│ - message-handler.js (消息处理) 
│ 
│ - *-download-manager.js (下载管理) 
│ 
└──────────────┬──────────────────────────┘ 
               │ 
┌──────────────▼──────────────────────────┐ 
│ Data Layer (数据层) 
│ 
│ - database.js (IndexedDB) 
│ 
│ - file-system.js (文件系统) 
│ 
│ - backup-manager.js (备份管理) ⭐ 
│ 
│ - relation-manager.js (关系表) 
│ 
└──────────────┬──────────────────────────┘ 
               │ 
┌──────────────▼──────────────────────────┐ 
│ API Layer (API 适配层)
│ 
│ - platform-adapter.js (统一接口) 
│ 
│ - douyin/api.js (抖音实现) 
│ 
│ - douyin/helpers.js (辅助函数) 
│ 
└──────────────┬──────────────────────────┘ 
               │ 
┌──────────────▼──────────────────────────┐ 
│ Config Layer (配置层) 
│ 
│ - constants.js (全局配置) 
│ 
└─────────────────────────────────────────┘

### 4.1 各层职责

| 层级 | 职责 | 关键文件 |
|------|------|---------|
| **UI Layer** | 用户界面、交互逻辑 | `ui/sidebar.html`, `ui/tab-manager.js` |
| **Core Layer** | 业务流程控制、消息分发 | `core/app.js`, `core/message-handler.js` |
| **Data Layer** | 数据持久化、备份管理 | `data/database.js`, `data/backup-manager.js` |
| **API Layer** | 平台适配、数据标准化 | `api/platform-adapter.js`, `api/douyin/api.js` |
| **Config Layer** | 全局配置、常量定义 | `config/constants.js` |

---

## 5. 核心模块

### 5.1 平台适配器模式

**文件：** `api/platform-adapter.js`

**职责：** 提供统一的平台 API 接口，屏蔽不同平台的差异。

**核心方法：**
platformAPI.switchPlatform('douyin') // 切换平台 
platformAPI.getCurrentUser() // 获取当前用户 
platformAPI.getFollowingList() // 获取关注列表 
platformAPI.getLikedWorks() // 获取点赞作品 
platformAPI.getBookmarkedWorks() // 获取收藏作品

**优势：**
- ✅ 支持运行时切换平台
- ✅ 新平台只需实现对应 API，无需修改上层代码
- ✅ 统一的数据标准化流程

### 5.2 数据标准化

**文件：** `utils/platform-helpers.js`

**核心函数：**
normalizeVideoData(rawData, options) // 标准化作品数据 
normalizeAuthorData(rawData, options) // 标准化作者数据

**标准化字段映射：**
- 作品：`workId`, `author`, `createTime`, `video.pageUrl`, `video.coverUrl`, `images`, `isImagePost` 等
- 作者：`uid`, `platformId`, `nickname`, `avatarUrl`, `signature` 等

### 5.3 备份管理系统

**文件：** `data/backup-manager.js`

**职责：** 管理数据备份和恢复，支持跨平台社交内容备份。

**核心功能：**

#### 5.3.1 全量备份
await backupManager.performFullBackup({ force: false })

**备份流程：**
1. 加载 manifest（记录上次备份的哈希值）
2. 备份 authors 表（哈希对比）
3. 备份 collects 表（哈希对比）
4. 备份 author_groups 表（哈希对比）
5. 备份 liked_group 表（哈希对比）
6. 备份 works 表（按季度分片 + 哈希对比）
7. 备份 relations 表（哈希对比）
8. 保存 manifest

#### 5.3.2 增量检测
- 使用哈希对比检测数据变化
- 无变化跳过备份，有变化才写入
- 避免无效备份，提高效率

#### 5.3.3 季度分片
- works 表按 `createTime` 分片存储
- 格式：`works_2024_Q1.json`, `works_2024_Q2.json` 等
- 降低单文件大小，提高查询效率

#### 5.3.4 定时备份
backupManager.startPeriodicBackup() // 启动定时备份 
backupManager.stopPeriodicBackup() // 停止定时备份

**触发条件：**
- 时间间隔：默认 1 小时（可配置）
- 列表加载：每 5 批（约 100 个作品）触发一次
- 设置修改：即时备份

### 5.4 文件系统操作

**文件：** `data/file-system.js`

**职责：** 提供文件系统操作方法，不负责备份策略。

**核心方法：**
fileSystem.requestDirectoryPermission() // 请求用户授权目录 
fileSystem.setDirectoryHandle(handle) // 设置目录句柄 
fileSystem.writeFile(path, content) // 写入文件 
fileSystem.readFile(path) // 读取文件

**目录结构：**
用户选择的根目录/ 
├── data/ 
│ └── .appdata/ 
│ ├── metadata/ # 元数据存储 
│ │ ├── manifest.json # 备份清单 
│ │ ├── authors_base.js 
│ │ ├── collects_base.js 
│ │ ├── works/ # 作品分片 
│ │ │ ├── works_2024_Q1.json 
│ │ │ └── works_2024_Q2.json 
│ │ └── ... 
│ ├── js/ # JS/CSS 资源 
│ └── logs/ # 日志文件
├── 抖音/ # 平台文件夹
│ └── 作者昵称(uid)/ # 作者文件夹
│ │ ├── 封面/
│ │ ├── 视频/
│ │ └── 图集/


### 5.5 数据库设计

**文件：** `data/database.js`

**数据库名称：** `FavGallery`

**版本：** 1

**对象存储（Stores）：**

| Store | 主键 | 说明 |
|-------|------|------|
| `works` | `workId` | 作品元数据 |
| `completed_works` | `workId` | 已完成作品ID |
| `relations` | `id` | 通用关系表 |
| `liked_group` | `groupId` | 点赞分组元数据 |
| `authors` | `uid` | 作者列表元数据 |
| `collects` | `collectId` | 收藏夹列表元数据 |
| `author_groups` | `groupId` | 作者分组元数据 |
| `settings` | `key` | 系统设置 |

**索引：**
- `works`: `author.uid`, `createTime`
- `completed_works`: `downloadTime`
- `relations`: `sourceType+sourceId`, `targetType+targetId`, `sourceToTarget`（唯一）

### 5.6 列表显示管理器

**文件：** `core/list-display-manager.js`

**职责：** 封装列表显示相关的业务逻辑，负责加载、进度、错误处理和下载状态查询。

**核心功能：**

#### 5.6.1 列表加载协调
```javascript
listDisplayManager.handleLoadLikedVideos() // 发起加载请求
listDisplayManager.handleLikedWorksLoaded(works, total, likedManager) // 处理加载完成
```

**流程：**
1. 检查文件夹选择状态
2. 发送消息到 Content Script
3. 接收数据后批量查询下载状态
4. 合并下载状态到作品数据
5. 同步 checkbox 选中状态
6. 更新 UI 显示

#### 5.6.2 下载状态管理
```javascript
listDisplayManager.getDownloadedWorkIds() // 查询已下载作品 ID
listDisplayManager.refreshDownloadStatus(likedManager) // 刷新下载状态
```

**优势：**
- ✅ 职责分离 - 列表显示逻辑与核心业务解耦
- ✅ 可测试性 - 可以独立测试列表显示逻辑
- ✅ 可扩展性 - 易于添加收藏/关注列表支持
- ✅ 避免重复 - 所有列表显示逻辑集中管理

---

## 6. 数据流图

### 6.1 列表加载流程

用户点击“加载点赞列表” 
↓ 
core/app.js 调用 listDisplayManager.handleLoadLikedVideos()
↓ 
content/main.js 发送消息到 Content Script
↓ 
platformAPI.getLikedWorks() 
↓ 
api/douyin/api.js 调用抖音 API
↓ 
content/services/data-fetcher.js 获取并处理数据 
↓ 
database.saveWorks() 保存到 IndexedDB 
↓ 
relationManager.batchAddRelations() 建立关系 
↓ 
backupManager.performFullBackup() 触发备份（每 5 批） 
↓ 
core/list-display-manager.js 处理返回数据
↓ 
返回结果给 UI

### 6.2 作品下载流程

用户选择作品 → 点击下载 
↓ 
core/batch-download-manager.js 创建任务 
↓ 
download/single-downloader.js 下载单个作品 
↓ 
fileSystem.writeFile() 保存到文件系统 
↓ 
database.saveCompletedWork() 标记为已完成 
↓ 
更新 UI 进度

---

## 7. 设计决策

### 7.1 数据模型命名规范

- ✅ 使用驼峰命名：`workId`, `createTime`, `platformId`
- ❌ 禁止下划线前缀：`_id`, `_type`
- ✅ 术语统一：作品（work）、作者（author）、收藏（collect）

### 7.2 软删除策略

- 所有表添加 `isDeleted` 字段
- 取消操作不删除记录，只标记 `isDeleted = true`
- 防止数据丢失，支持后期恢复

### 7.3 关系表设计

- 只插入不删除
- 即使取消点赞也保留历史记录
- 通过 `isDeleted` 标记失效关系

### 7.4 备份策略

- **覆盖式重写** + **哈希对比**
- 无变化跳过备份，有变化才写入
- 按季度分片存储大文件
- Manifest 记录每个表的哈希值

### 7.5 文件存储结构

- **扁平化按需创建**：只在需要时创建目录
- **封面独立存储**：封面单独存放在"封面"文件夹
- **作者分类**：按作者 ID 分类存储，避免冗余

---

## 8. 总结

FavGallery 采用**分层架构**设计，职责清晰，易于维护和扩展：

- ✅ **API 层**：平台适配，统一接口
- ✅ **数据层**：持久化存储，备份管理
- ✅ **核心层**：业务逻辑，流程控制
- ✅ **UI 层**：用户交互，状态管理

**核心优势：**
- 🎯 跨平台支持（易于扩展）
- 🎯 增量备份（高效可靠）
- 🎯 季度分片（性能优化）
- 🎯 模块化设计（易于维护）














