# FavGallery 贡献指南

感谢你考虑为 FavGallery 做出贡献！在开始之前，请花几分钟阅读本指南。

---

## 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交 PR](#提交-pr)
- [代码审查](#代码审查)

---

## 行为准则

本项目致力于营造一个开放、友好的社区环境。所有参与者都应：

- ✅ 尊重他人观点和经验
- ✅ 提供建设性的反馈
- ✅ 关注项目的最佳利益
- ❌ 避免人身攻击或歧视性言论
- ❌ 不要发布无关内容

---

## 如何贡献

### 1. 报告 Bug

如果你发现了 Bug，请创建 Issue 并包含：

- **问题描述**：清晰简洁地描述问题
- **复现步骤**：详细的操作步骤
- **预期行为**：应该发生什么
- **实际行为**：实际发生了什么
- **环境信息**：浏览器版本、扩展版本等
- **截图/日志**：如有可能，提供截图或日志

### 2. 提出新功能建议

新功能建议请创建 Feature Request Issue：

- **功能描述**：你想要实现什么？
- **使用场景**：为什么需要这个功能？
- **替代方案**：当前有哪些替代方案？
- **额外信息**：其他相关信息

### 3. 代码贡献

我们欢迎各种类型的代码贡献：

- 🐛 Bug 修复
- ✨ 新功能实现
- 📝 文档改进
- ♻️ 代码重构
- ⚡ 性能优化
- 🧪 测试补充

---

## 开发流程

### 前置要求

- Chrome 浏览器（最新版本）
- Git
- 代码编辑器（推荐 VS Code）

### 设置开发环境

1. **Fork 仓库**
   ```bash
   # 在 GitHub 上点击 Fork 按钮
   ```

2. **克隆仓库**
   ```bash
   git clone https://github.com/YOUR_USERNAME/FavGallery.git
   cd FavGallery
   ```

3. **添加上游远程**
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/FavGallery.git
   ```

4. **安装依赖**（如果有）
   ```bash
   npm install
   ```

5. **加载扩展到 Chrome**
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目根目录

### 分支策略

```
main              # 主分支，保持稳定
  ├── feature/*   # 新功能分支
  ├── bugfix/*    # Bug 修复分支
  ├── refactor/*  # 重构分支
  └── docs/*      # 文档分支
```

**分支命名规范：**
- `feature/add-xiaohongshu-support`
- `bugfix/fix-download-error`
- `refactor/simplify-data-fetcher`
- `docs/update-api-docs`

### 开发步骤

1. **从 main 创建新分支**
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feature/your-feature-name
   ```

2. **编码**
   - 遵循 [项目开发规则](./docs/DEVELOPMENT_RULES.md)
   - 编写清晰的注释
   - 添加必要的测试

3. **本地测试**
   - 在 Chrome 中重新加载扩展
   - 测试所有相关功能
   - 检查控制台是否有错误

4. **提交代码**
   ```bash
   git add .
   git commit -m "feat: add xxx feature"
   ```

5. **推送到远程**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 填写 PR 模板
   - 等待代码审查

---

## 代码规范

### ⭐⭐⭐ 必须遵守的核心规则

1. **五层架构**：严格遵守 UI → Core → Content Script → Data → API → Config
2. **七大原则**：跨平台、配置驱动、单一职责、跨上下文分离、软删除、关系统一、增量备份
3. **命名规范**：使用统一术语（workId、author、collect 等）

### 详细规范

请查看：
- 📖 [完整开发规则](./docs/DEVELOPMENT_RULES.md)
- 💡 [快速参考卡片](./docs/QUICK_REFERENCE.md)

### 代码风格

```javascript
// ✅ 正确示例
class DownloadManager {
    async handleDownload(workId) {
        try {
            const work = await platformAPI.getWorkDetail(workId);
            logger.info('✅ 下载成功');
            return work;
        } catch (error) {
            logger.error('❌ 下载失败:', error);
            throw error;
        }
    }
}

// ❌ 错误示例
class download_manager {
    async download_video(video_id) {
        const data = await douyinAPI.getVideo(video_id);  // 硬编码
        return data;  // 无错误处理
    }
}
```

---

## 提交 PR

### PR 标题规范

使用语义化提交前缀：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建过程或辅助工具变动

**示例：**
```
feat: add Xiaohongshu platform support
fix: resolve download timeout issue
docs: update API documentation
refactor: simplify data-fetcher logic
```

### PR 描述

创建 PR 时会自动显示 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)，请认真填写：

1. **变更类型**：勾选对应的类型
2. **变更说明**：简要描述本次变更
3. **相关 Issue**：关联的 Issue 编号
4. **测试步骤**：如何测试本次变更
5. **注意事项**：需要审查者特别关注的地方

### PR 检查清单

在提交 PR 前，请确认：

- [ ] 我已阅读并遵守 [项目开发规则](./docs/DEVELOPMENT_RULES.md)
- [ ] 我的代码遵循五层架构
- [ ] 我使用了正确的术语和命名规范
- [ ] 我添加了必要的注释和文档
- [ ] 我在本地测试了所有变更
- [ ] 我的提交信息清晰明了
- [ ] 我更新了 PR 模板中的所有必填项

---

## 代码审查

### 审查流程

1. **自动检查**
   - CI/CD 运行自动化测试
   - 代码风格检查
   - 依赖安全检查

2. **人工审查**
   - 代码所有者审查（见 [CODEOWNERS](./.github/CODEOWNERS)）
   - 至少需要 1 个批准
   - 重点关注核心原则

3. **修改建议**
   - 审查者提出修改建议
   - 作者进行修改
   - 重新提交审查

4. **合并**
   - 所有检查通过
   - 获得足够批准
   - 由维护者合并到 main

### 审查重点

#### ⭐⭐⭐ 核心原则（违反将拒绝 PR）

1. **跨平台通用性**
   - ❌ 硬编码平台特定值
   - ✅ 使用 platformAPI

2. **配置驱动**
   - ❌ 为每个列表写独立逻辑
   - ✅ 使用 listConfigs

3. **跨上下文通信**
   - ❌ Sidebar 传递完整数据
   - ✅ 只传递意图（workId）

#### ⭐⭐ 重要原则

4. **单一职责** - 模块职责是否清晰？
5. **软删除** - 是否正确标记 isDeleted？
6. **关系统一** - 是否使用 relations 表？
7. **增量备份** - 是否有哈希对比？

### 常见审查意见

| 问题 | 建议 |
|------|------|
| 硬编码平台值 | 使用 `platformAPI.getXxx()` |
| 物理删除记录 | 改为标记 `isDeleted = true` |
| 跨层调用 | 通过中间层转发 |
| 缺少错误处理 | 添加 try-catch 和日志 |
| N+1 查询 | 改为批量查询 |
| 术语不一致 | 使用标准术语（workId、uid 等） |

---

## 常见问题

### Q: 我不确定某个实现是否符合规范怎么办？

A: 
1. 先查看 [开发规则文档](./docs/DEVELOPMENT_RULES.md)
2. 参考现有代码的实现方式
3. 在 Issue 中提问或讨论
4. **不确定时，先讨论再编码！**

### Q: 我的 PR 为什么被拒绝了？

A: 常见原因：
- 违反了核心设计原则
- 代码质量不达标
- 缺少测试或文档
- 与项目方向不符

请仔细阅读审查意见，进行修改后重新提交。

### Q: 我可以同时提交多个 PR 吗？

A: 可以，但建议：
- 每个 PR 只做一件事
- 等待前一个 PR 合并后再提交下一个
- 避免 PR 之间的依赖

### Q: 多久能得到回复？

A: 
- Bug 修复：1-3 个工作日
- 新功能：3-7 个工作日
- 文档更新：1-5 个工作日

如果超过一周未回复，可以在 PR 中 @ 维护者。

---

## 联系方式

- 📧 Email: （待补充）
- 💬 Discord: （待补充）
- 🐛 Issues: [GitHub Issues](https://github.com/FavGallery/FavGallery/issues)

---

## 致谢

感谢所有为 FavGallery 做出贡献的开发者！你们的努力让这个项目变得更好。

---

**最后提醒：在提交代码前，请务必阅读 [项目开发规则](./docs/DEVELOPMENT_RULES.md)！**
