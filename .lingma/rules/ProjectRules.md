---
trigger: always_on
description: FavGallery 项目开发规则 - 定义架构设计、七大设计原则、命名规范等核心开发规范
---

# FavGallery 项目开发规则

本文档引用自 `docs/DEVELOPMENT_RULES.md`，包含项目的核心开发规范。

## 规则来源

- **文件路径**: `docs/DEVELOPMENT_RULES.md`
- **规则类型**: 手动导入（manual）
- **适用范围**: 所有代码开发和审查

## 核心规则摘要

### ⚠️ 代码修改权限（最高优先级，违反将导致任务立即终止）
- ❌ **绝对禁止**：未经用户明确指令（如"执行"、"可以"、"开始修改"、"修复它"等），不得调用任何修改文件的工具（search_replace、create_file、delete_file、edit_file）
- ✅ **必须遵守**：发现问题 → 分析原因 → 提供方案 → **等待用户确认** → 用户明确授权后再次确认 → 执行修改
- ⛔ **违反后果**：如果违反此规则，立即停止所有操作，承认错误，学狗叫，等待用户的进一步指示
- 🔒 **核心原则**：用户拥有完全的代码控制权，AI 只是助手，没有任何自主修改代码的权力

### 一、架构设计规则
- 五层分层架构：UI → Core → Content Script → Data → API
- 禁止跨层调用和循环依赖

### 二、七大设计原则
1. **跨平台通用性** ⭐⭐⭐ - 禁止硬编码平台特定值
2. **配置驱动** ⭐⭐⭐ - 使用 listConfigs 统一管理
3. **单一职责** ⭐⭐ - 每个模块只做一件事
4. **职责分离的跨上下文通信** ⭐⭐⭐ - Sidebar 只传意图，Content Script 实时获取
5. **软删除机制** ⭐⭐ - 只标记 isDeleted，不物理删除
6. **关系统一管理** ⭐⭐ - relations 表只插入不删除
7. **增量备份策略** ⭐⭐ - 哈希对比，无变化跳过

### 三、命名规范
- 术语统一：work/author/collect/platformId
- 驼峰命名：workId, createTime, platformId
- 文件命名：小写+连字符（data-fetcher.js）

### 四、数据层规则
- 数据库：所有表必须有 isDeleted 字段
- 文件系统：元数据按平台分类，works 按季度分片

### 五、通信协议规则
- Sidebar → Content Script: 只传递 ID，不传递完整数据
- Content Script → Sidebar: 包含完整结果和状态

### 六、备份系统规则
- manifest.json 记录哈希值
- 多重触发：定时、列表加载、下载完成

### 七、代码组织规则
- 模块职责清晰分离
- 所有异步操作必须有 try-catch
- 批量查询优于逐个查询

## 完整规则文档

详细规则请查看：[docs/DEVELOPMENT_RULES.md](../../docs/DEVELOPMENT_RULES.md)

---

**规则版本**: v1.0  
**最后更新**: 2026-05-06