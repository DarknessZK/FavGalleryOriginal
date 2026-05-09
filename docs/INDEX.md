# 📚 FavGallery 文档导航

> 本文档提供所有项目文档的快速索引和说明

---

## 🎯 快速开始

### 我是新贡献者，应该先看什么？

1. 📖 [README.md](../README.md) - 项目介绍
2. 🤝 [CONTRIBUTING.md](../CONTRIBUTING.md) - 如何贡献
3. 💡 [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - 快速参考（编码时必备）
4. ⭐ [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) - 完整开发规则

### 我要提交 PR，需要做什么？

1. 阅读 [CONTRIBUTING.md](../CONTRIBUTING.md) 了解流程
2. 对照 [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) 检查代码
3. 填写 [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)
4. 等待审查（见 [CODE_REVIEW_SYSTEM.md](./CODE_REVIEW_SYSTEM.md)）

### 我是审查者，应该关注什么？

1. 📋 [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) - PR 检查清单
2. ⭐⭐⭐ 七大设计原则（见 [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) 第二部分）
3. 🔍 [CODE_REVIEW_SYSTEM.md](./CODE_REVIEW_SYSTEM.md) - 审查流程和重点

---

## 📂 文档分类

### 🏗️ 架构与设计

| 文档 | 说明 | 适用人群 |
|------|------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 五层架构、模块详解、数据流图 | 架构师、高级开发者 |
| [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) | **完整的开发规范**（782行） | **所有开发者** ⭐ |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | 数据库设计、表结构、索引 | 后端开发者 |
| [FILE_SYSTEM_STRUCTURE.md](./FILE_SYSTEM_STRUCTURE.md) | 文件系统目录结构 | 所有开发者 |

### 📝 开发指南

| 文档 | 说明 | 适用人群 |
|------|------|---------|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献者指南、开发流程 | 新贡献者 |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | **快速参考卡片**（禁止事项、必遵守项） | **所有开发者** 💡 |
| [MEMORY_GUIDE.md](./MEMORY_GUIDE.md) | 记忆清理指南、建议保留的记忆 | 维护者 |
| [TODO.md](./TODO.md) | 待办事项、未来规划 | 维护者 |

### 🔍 代码审查

| 文档 | 说明 | 适用人群 |
|------|------|---------|
| [CODE_REVIEW_SYSTEM.md](./CODE_REVIEW_SYSTEM.md) | 审查流程、决策树、评分卡 | 审查者 |
| [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | PR 检查清单模板 | 所有提交 PR 的人 |
| [CODEOWNERS](../.github/CODEOWNERS) | 代码所有者配置 | 维护者 |

### 🌐 API 文档

| 文档 | 说明 | 适用人群 |
|------|------|---------|
| [API.md](./API.md) | 平台适配器、API 方法说明 | API 开发者 |

---

## 🎓 学习路径

### 初级开发者（第1周）

```
Day 1: 阅读 README.md → 了解项目
Day 2: 阅读 CONTRIBUTING.md → 了解如何贡献
Day 3: 阅读 QUICK_REFERENCE.md → 记住禁止事项
Day 4-5: 搭建开发环境，尝试修复简单 Bug
Day 6-7: 阅读 ARCHITECTURE.md → 理解整体架构
```

### 中级开发者（第2-4周）

```
Week 2: 深入学习 DEVELOPMENT_RULES.md → 掌握七原则
Week 3: 参与实际功能开发，接受代码审查
Week 4: 学习 DATABASE_SCHEMA.md 和 FILE_SYSTEM_STRUCTURE.md
```

### 高级开发者（第2个月起）

```
Month 2: 参与代码审查，熟悉 CODE_REVIEW_SYSTEM.md
Month 3: 优化架构设计，提出改进建议
Month 4+: 成为代码所有者，指导新人
```

---

## 🔑 核心概念速查

### 五层架构
```
UI Layer (ui/)           → 用户界面
    ↓
Core Layer (core/)       → 业务逻辑
    ↓
Content Script (content/)→ 页面逻辑
    ↓
Data Layer (data/)       → 数据持久化
    ↓
API Layer (api/)         → 平台适配
    ↓
Config Layer (config/)   → 全局配置
```

### 七大设计原则
1. ⭐⭐⭐ 跨平台通用性 - 禁止硬编码
2. ⭐⭐⭐ 配置驱动 - 使用 listConfigs
3. ⭐⭐ 单一职责 - 每个模块只做一件事
4. ⭐⭐⭐ 跨上下文通信 - Sidebar 只传意图
5. ⭐⭐ 软删除 - isDeleted 标记
6. ⭐⭐ 关系统一 - relations 表
7. ⭐⭐ 增量备份 - 哈希对比

### 术语规范
| 概念 | ✅ 正确 | ❌ 错误 |
|------|--------|--------|
| 作品 | work / workId | video / awemeId |
| 作者 | author / uid | user / userId |
| 收藏 | collect / collectId | favorite / favId |
| 平台ID | platformId | sec_uid |

---

## 📊 文档使用统计（建议追踪）

| 文档 | 月度浏览量 | 主要读者 | 更新频率 |
|------|-----------|---------|---------|
| QUICK_REFERENCE.md | 🔥 高 | 所有开发者 | 每月 |
| DEVELOPMENT_RULES.md | 🔥 高 | 所有开发者 | 每季度 |
| CONTRIBUTING.md | 🟡 中 | 新贡献者 | 半年 |
| ARCHITECTURE.md | 🟡 中 | 高级开发者 | 季度 |
| CODE_REVIEW_SYSTEM.md | 🟢 低 | 审查者 | 季度 |

---

## 💬 获取帮助

### 文档相关问题

1. **先搜索**：在文档中搜索关键词
2. **看示例**：查看代码示例和正误对比
3. **提 Issue**：在 GitHub 创建 Issue
4. **问社区**：在 Discord 或邮件列表提问

### 常见问题

**Q: 我不确定某个实现是否符合规范？**
A: 查看 [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) 的禁止事项，或查阅 [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) 的详细说明。

**Q: 我的 PR 为什么被拒绝了？**
A: 检查审查意见，对照 [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) 的检查清单，特别关注标有 ⭐⭐⭐ 的核心原则。

**Q: 如何快速上手？**
A: 按照 [学习路径](#-学习路径) 的建议，从 README → CONTRIBUTING → QUICK_REFERENCE 开始。

---

## 🔄 文档更新流程

### 何时更新文档？

- ✅ 新增功能时 → 更新相关文档
- ✅ 修改架构时 → 更新 ARCHITECTURE.md
- ✅ 发现规范漏洞时 → 更新 DEVELOPMENT_RULES.md
- ✅ 收到常见问题时 → 更新 FAQ 或 QUICK_REFERENCE.md

### 如何提出文档改进？

1. 创建 Issue 描述问题
2. 提出改进方案
3. 提交 PR 修改文档
4. 社区讨论和审查
5. 合并更新

---

## 📌 重要提醒

### ⭐⭐⭐ 必须阅读的文档

1. **[DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)** - 所有代码必须符合此规范
2. **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - 编码时随时查阅
3. **[CONTRIBUTING.md](../CONTRIBUTING.md)** - 贡献前必读

### 💡 建议收藏的文档

- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - 添加到浏览器书签
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) - 打印出来放在桌边

### 🔍 审查者必备

- [CODE_REVIEW_SYSTEM.md](./CODE_REVIEW_SYSTEM.md)
- [PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)

---

## 📈 文档质量指标

我们致力于保持文档的高质量：

- ✅ **准确性**：与实际代码一致
- ✅ **完整性**：覆盖所有重要方面
- ✅ **可读性**：清晰易懂，有示例
- ✅ **及时性**：随代码同步更新
- ✅ **可搜索**：良好的结构和索引

---

## 🙏 致谢

感谢所有为文档做出贡献的开发者！好的文档能让项目走得更远。

---

**最后提醒：不确定时，先阅读文档再编码！**

📖 [返回 README](../README.md) | 🤝 [开始贡献](../CONTRIBUTING.md) | 💡 [快速参考](./QUICK_REFERENCE.md)
