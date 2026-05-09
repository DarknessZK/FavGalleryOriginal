# FavGallery 代码审查体系

本文档说明如何将 [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) 作为代码审查标准。

---

## 📋 已建立的审查体系

### 1. 核心文档

| 文档 | 用途 | 位置 |
|------|------|------|
| **DEVELOPMENT_RULES.md** | 完整的开发规范（782行） | `docs/DEVELOPMENT_RULES.md` |
| **QUICK_REFERENCE.md** | 快速参考卡片（编码时查阅） | `docs/QUICK_REFERENCE.md` |
| **CONTRIBUTING.md** | 贡献者指南 | `CONTRIBUTING.md` |
| **PULL_REQUEST_TEMPLATE.md** | PR 检查清单 | `.github/PULL_REQUEST_TEMPLATE.md` |
| **CODEOWNERS** | 代码所有者配置 | `.github/CODEOWNERS` |

### 2. README 更新

已在 [README.md](./README.md) 中添加开发文档链接：

```markdown
📖 **开发文档**：
- [架构设计文档](./docs/ARCHITECTURE.md)
- [项目开发规则](./docs/DEVELOPMENT_RULES.md) ⭐ **所有 PR 必须符合此规范**
- [快速参考卡片](./docs/QUICK_REFERENCE.md) 💡 编码时快速查阅
- [记忆指南](./docs/MEMORY_GUIDE.md)
```

---

## 🔄 代码审查流程

### 阶段一：提交前（开发者自查）

1. **阅读规范**
   - 查看 [QUICK_REFERENCE.md](./docs/QUICK_REFERENCE.md) 了解禁止事项
   - 对照七原则检查清单

2. **本地测试**
   - 在 Chrome 中测试功能
   - 检查控制台日志
   - 验证数据一致性

3. **填写 PR 模板**
   - 自动显示 [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md)
   - 勾选所有检查项
   - 提供详细的变更说明

### 阶段二：自动化检查（CI/CD）

建议配置以下自动化检查（待实现）：

```yaml
# .github/workflows/code-review.yml
name: Code Review

on: [pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run ESLint
        run: npm run lint
      
  check-naming:
    runs-on: ubuntu-latest
    steps:
      - name: Check naming conventions
        run: |
          # 检查是否使用了错误的术语
          grep -r "videoId\|userId\|secUid" --include="*.js" || exit 0
          echo "❌ Found incorrect terminology"
          exit 1
```

### 阶段三：人工审查（代码所有者）

根据 [.github/CODEOWNERS](./.github/CODEOWNERS) 分配审查者：

```
*                    → @FavGallery/core-team
/core/, /api/        → @FavGallery/architect
/data/               → @FavGallery/data-lead
/ui/                 → @FavGallery/ui-lead
```

**审查重点：**

#### ⭐⭐⭐ 必须检查的核心原则

1. **跨平台通用性**
   ```javascript
   // ❌ 拒绝
   const group = 'DouYin';
   
   // ✅ 通过
   const group = platformAPI.getDefaultAuthorGroup();
   ```

2. **配置驱动**
   ```javascript
   // ❌ 拒绝
   async loadLikedWorks() { /* 独立逻辑 */ }
   async loadBookmarkedWorks() { /* 独立逻辑 */ }
   
   // ✅ 通过
   async loadList(listType) {
       return this._loadListInternal(listType);
   }
   ```

3. **跨上下文通信**
   ```javascript
   // ❌ 拒绝
   postMessage({ type: 'DOWNLOAD', work: {...} });
   
   // ✅ 通过
   postMessage({ type: 'DOWNLOAD_WORK_BY_ID', workId: '7xxx' });
   ```

#### ⭐⭐ 重要检查项

4. **单一职责** - 模块是否只做一件事？
5. **软删除** - 是否标记 isDeleted 而非物理删除？
6. **关系统一** - 是否使用 relations 表？
7. **增量备份** - 是否有哈希对比？

### 阶段四：修改与重新提交

如果审查不通过：

1. 审查者在 PR 中提出具体修改意见
2. 开发者根据意见修改代码
3. 推送新的 commit
4. 审查者重新审查
5. 通过后合并

### 阶段五：合并后

1. 自动关闭关联的 Issue
2. 触发 CI/CD 部署流程
3. 更新 CHANGELOG（如有）
4. 通知相关人员

---

## 🎯 审查决策树

```
收到 PR
  ↓
是否符合命名规范？ ──── 否 ──→ 拒绝，要求修改
  ↓ 是
是否违反七原则？ ───── 是 ──→ 拒绝，要求重构
  ↓ 否
是否有充分的测试？ ── 否 ──→ 要求补充测试
  ↓ 是
是否有文档更新？ ──── 否 ──→ 要求补充文档
  ↓ 是
代码质量是否达标？ ── 否 ──→ 要求优化
  ↓ 是
批准合并 ✓
```

---

## 📊 审查评分卡（可选）

为每个 PR 打分（满分 100）：

| 项目 | 分值 | 说明 |
|------|------|------|
| 架构设计 | 20 | 是否符合五层架构 |
| 七原则遵守 | 30 | 是否违反核心原则 |
| 命名规范 | 15 | 术语和命名是否正确 |
| 代码质量 | 15 | 可读性、可维护性 |
| 测试覆盖 | 10 | 是否有充分测试 |
| 文档完整 | 10 | 是否更新文档 |

**评分标准：**
- 90-100: 优秀，直接合并
- 75-89: 良好，小修后合并
- 60-74: 合格，需要修改
- <60: 不合格，大幅修改或拒绝

---

## 🚨 常见违规及处理

### 严重违规（立即拒绝）

| 违规行为 | 处理方式 |
|---------|---------|
| 硬编码平台特定值 | 拒绝，要求使用 platformAPI |
| 跨层直接调用 | 拒绝，要求重构 |
| 物理删除记录 | 拒绝，改为软删除 |
| Sidebar 传递完整数据 | 拒绝，改为只传 ID |

### 一般违规（要求修改）

| 违规行为 | 处理方式 |
|---------|---------|
| 命名不规范 | 要求重命名 |
| 缺少注释 | 要求补充注释 |
| 错误处理不完善 | 要求添加 try-catch |
| 性能问题 | 要求优化 |

### 轻微问题（建议改进）

| 问题 | 处理方式 |
|------|---------|
| 代码格式不统一 | 自动格式化或建议 |
| 日志不够详细 | 建议增加日志 |
| 变量名不够清晰 | 建议重命名 |

---

## 🛠️ 工具支持

### 推荐的审查工具

1. **ESLint 规则**（待配置）
   ```json
   {
     "rules": {
       "no-restricted-syntax": [
         "error",
         {
           "selector": "Identifier[name=/^(videoId|userId|secUid)$/]",
           "message": "Use workId, authorUid, or platformId instead"
         }
       ]
     }
   }
   ```

2. **Husky + lint-staged**（待配置）
   ```json
   {
     "husky": {
       "hooks": {
         "pre-commit": "lint-staged"
       }
     },
     "lint-staged": {
       "*.js": ["eslint --fix", "git add"]
     }
   }
   ```

3. **GitHub Actions**（待配置）
   - 自动运行 lint
   - 检查命名规范
   - 运行单元测试

### 手动审查辅助

1. **搜索违规模式**
   ```bash
   # 查找硬编码的平台名称
   grep -rn "DouYin\|douyin" --include="*.js" src/
   
   # 查找错误的术语
   grep -rn "videoId\|userId\|secUid" --include="*.js" src/
   
   # 查找物理删除
   grep -rn "\.delete(" --include="*.js" src/
   ```

2. **代码复杂度分析**
   ```bash
   npx complexity-report src/**/*.js
   ```

---

## 📈 持续改进

### 定期回顾

每月进行一次审查体系回顾：

1. **统计数据分析**
   - PR 平均审查时间
   - 常见违规类型
   - 审查通过率

2. **收集反馈**
   - 开发者对规范的疑问
   - 审查者的困难
   - 规范的不足之处

3. **更新规范**
   - 补充新的最佳实践
   - 修正不合理的规则
   - 简化复杂的流程

### 培训与分享

1. **新成员培训**
   - 讲解七原则
   - 演示常见错误
   - 代码审查实战

2. **经验分享**
   - 优秀的 PR 案例
   - 典型的违规案例
   - 审查技巧分享

---

## 📞 支持与联系

### 审查相关问题

- 📖 查看 [DEVELOPMENT_RULES.md](./docs/DEVELOPMENT_RULES.md)
- 💡 查看 [QUICK_REFERENCE.md](./docs/QUICK_REFERENCE.md)
- 🐛 提交 Issue 提问
- 👥 联系代码所有者

### 规范改进建议

欢迎提出规范改进建议：

1. 创建 Issue 描述问题
2. 提出改进方案
3. 社区讨论
4. 更新规范文档

---

## ✅ 检查清单

确保代码审查体系正常运行：

- [x] 创建了 DEVELOPMENT_RULES.md
- [x] 创建了 QUICK_REFERENCE.md
- [x] 创建了 CONTRIBUTING.md
- [x] 创建了 PULL_REQUEST_TEMPLATE.md
- [x] 创建了 CODEOWNERS
- [x] 更新了 README.md
- [ ] 配置 ESLint 规则（待完成）
- [ ] 配置 Husky（待完成）
- [ ] 配置 GitHub Actions（待完成）
- [ ] 培训团队成员（待完成）

---

**记住：代码审查的目的是提高代码质量，而不是找茬。保持友好、建设性的沟通！**
