# FavGallery 开发快速参考

> 💡 **提示**：完整规则请查看 [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)

---

## 🚫 禁止事项（违反将导致 PR 被拒绝）

### ❌ 术语错误
```javascript
// ❌ 错误
const videoId = '7xxx';        // 应该用 workId
const userId = 'xxx';          // 应该用 uid
const secUid = 'xxx';          // 应该用 platformId

// ✅ 正确
const workId = '7xxx';
const authorUid = 'xxx';
const platformId = 'xxx';
```

### ❌ 硬编码平台值
```javascript
// ❌ 错误
const group = 'DouYin';
const apiUrl = 'https://www.douyin.com/...';

// ✅ 正确
const group = platformAPI.getDefaultAuthorGroup();
const endpoints = CONFIG.API_ENDPOINTS[CONFIG.ACTIVE_PLATFORM];
```

### ❌ 跨层调用
```javascript
// ❌ 错误：UI 层直接调用 API
import { platformAPI } from '../../api/platform-adapter.js';

// ✅ 正确：通过核心层调用
this.app.messageHandler.send('LOAD_LIKED_WORKS');
```

### ❌ 物理删除
```javascript
// ❌ 错误
await database.delete('works', workId);

// ✅ 正确
work.isDeleted = true;
await database.save('works', work);
```

### ❌ 传递完整数据
```javascript
// ❌ 错误：Sidebar 传递完整作品对象
postMessage({ type: 'DOWNLOAD_WORK', work: {...} });

// ✅ 正确：只传递 workId
postMessage({ type: 'DOWNLOAD_WORK_BY_ID', workId: '7xxx' });
```

---

## ✅ 必须遵守

### 1. 命名规范
- ✅ 驼峰命名：`workId`, `createTime`, `platformId`
- ✅ 文件命名：`data-fetcher.js`, `backup-manager.js`
- ✅ 类命名：`DownloadManager`, `MessageHandler`
- ✅ 方法命名：`handleDownload`, `handleLoad`

### 2. 七原则检查清单
```
□ 跨平台通用性 - 无硬编码，使用 platformAPI
□ 配置驱动 - 使用 listConfigs，不复用代码
□ 单一职责 - 每个模块只做一件事
□ 跨上下文分离 - Sidebar 只传意图
□ 软删除 - isDeleted 标记，不物理删除
□ 关系统一 - relations 表，只插入不删除
□ 增量备份 - 哈希对比，季度分片
```

### 3. 消息格式
```javascript
// Sidebar → Content Script
{ source: 'sidebar', type: 'MESSAGE_TYPE', ... }

// Content Script → Sidebar
{ source: 'content', type: 'MESSAGE_TYPE', ... }
```

### 4. 数据库字段
所有表必须包含：`isDeleted: false`

### 5. 备份文件格式
- manifest.json：记录哈希值
- works：`works_2024_Q1.json.gz`（按季度分片+压缩）

---

## 🔍 代码审查重点

### ⭐⭐⭐ 核心原则（必须检查）
1. **跨平台通用性** - 是否有硬编码？
2. **配置驱动** - 是否复用 listConfigs？
3. **跨上下文通信** - 是否只传意图？

### ⭐⭐ 重要原则（强烈建议）
4. **单一职责** - 模块职责是否清晰？
5. **软删除** - 是否正确标记 isDeleted？
6. **关系统一** - 是否使用 relations 表？
7. **增量备份** - 是否有哈希对比？

---

## 📁 目录结构速查

```
ui/           # UI 层 - 界面和交互
core/         # 核心业务层 - 流程控制
content/      # Content Script 层 - 页面逻辑
data/         # 数据层 - 持久化和备份
api/          # API 适配层 - 平台接口
config/       # 配置层 - 全局常量
```

---

## 🛠️ 常用命令

```bash
# 代码检查（如果配置了 linter）
npm run lint

# 运行测试
npm test

# 查看日志
# 控制台：浏览器 DevTools
# 文件：用户目录/.FavGallery/logs/douyin/
```

---

## 📞 需要帮助？

1. 查看完整文档：[DEVELOPMENT_RULES.md](./docs/DEVELOPMENT_RULES.md)
2. 查看架构设计：[ARCHITECTURE.md](./docs/ARCHITECTURE.md)
3. 提交 Issue 提问
4. 联系代码所有者（见 CODEOWNERS 文件）

---

**记住：不确定时，先讨论再编码！**

