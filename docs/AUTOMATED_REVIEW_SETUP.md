# 自动化代码审查设置指南

本文档说明如何设置和使用 FavGallery 的自动化代码审查工具。

---

## 📋 已配置的工具

### 1. ESLint - 代码质量检查
- **配置文件**: `.eslintrc.json`
- **忽略文件**: `.eslintignore`
- **功能**: 
  - 检查命名规范（禁止 videoId、userId 等错误术语）
  - 检查硬编码平台值
  - 强制使用驼峰命名
  - 检查错误处理
  - 代码风格统一

### 2. GitHub Actions - CI/CD 自动化
- **工作流文件**: `.github/workflows/code-quality.yml`
- **触发条件**: push 到 main 分支或创建 PR
- **检查项目**:
  - ESLint 代码检查
  - 命名规范检查
  - 文件结构检查
  - Manifest 验证

### 3. Husky - Git 钩子（可选）
- **配置文件**: `.huskyrc.json`
- **功能**: 提交前自动运行 lint-staged

### 4. lint-staged - 暂存文件检查
- **配置文件**: `.lintstagedrc.json`
- **功能**: 只对即将提交的文件运行 ESLint

---

## 🚀 快速开始

### 步骤 1: 安装依赖

```bash
# 安装 ESLint
npm install

# 或者只安装 ESLint
npm install eslint --save-dev
```

### 步骤 2: 本地运行检查

```bash
# 运行 ESLint（显示所有问题和警告）
npm run lint

# 自动修复可修复的问题
npm run lint:fix

# 严格模式（有警告也失败）
npm run lint:strict
```

### 步骤 3: 提交代码

```bash
# 正常提交（如果配置了 Husky，会自动运行 lint-staged）
git add .
git commit -m "feat: add new feature"
git push
```

---

## 📊 GitHub Actions 工作流程

### 触发时机

```yaml
on:
  push:
    branches: [main]        # 推送到 main 分支时
  pull_request:
    branches: [main]        # 创建 PR 时
```

### 检查任务

#### 1. ESLint Check
- 运行 `npm run lint:strict`
- 有任何错误或警告都会失败
- **失败示例**:
  ```
  ❌ error  'videoId' is not allowed  no-restricted-syntax
  ```

#### 2. Naming Convention Check
- 检查是否使用了错误的术语
- 检查是否硬编码了平台值
- **失败示例**:
  ```
  ❌ 发现错误术语：videoId/awemeId，请使用 workId
  ```

#### 3. File Structure Check
- 验证必需的目录是否存在
- 验证必需的文件是否存在
- **失败示例**:
  ```
  ❌ 缺少必需目录: api
  ```

#### 4. Manifest Validation
- 验证 manifest.json 格式
- 检查必需字段
- **失败示例**:
  ```
  ❌ 缺少必需字段: manifest_version
  ```

---

## 🔧 自定义配置

### 修改 ESLint 规则

编辑 `.eslintrc.json`：

```json
{
  "rules": {
    // 将错误改为警告
    "no-unused-vars": "warn",
    
    // 禁用某个规则
    "camelcase": "off",
    
    // 调整规则参数
    "max-len": ["warn", { "code": 100 }]
  }
}
```

### 添加新的命名检查

在 `.eslintrc.json` 的 `no-restricted-syntax` 中添加：

```json
{
  "selector": "Identifier[name=/^(oldTerm)$/i]",
  "message": "❌ 禁止使用 oldTerm，请使用 newTerm"
}
```

### 修改 GitHub Actions

编辑 `.github/workflows/code-quality.yml`：

```yaml
# 添加新的检查任务
new-check:
  name: New Check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run check
      run: echo "Custom check"
```

---

## 🐛 常见问题

### Q1: ESLint 报错太多怎么办？

**A:** 分步修复：

```bash
# 1. 先自动修复可修复的问题
npm run lint:fix

# 2. 查看剩余问题
npm run lint

# 3. 逐个手动修复
```

### Q2: 某些文件不需要检查怎么办？

**A:** 添加到 `.eslintignore`：

```
# 忽略特定文件
legacy-code.js
vendor/some-lib.js

# 忽略整个目录
old-project/
```

### Q3: GitHub Actions 一直失败怎么办？

**A:** 查看日志：

1. 进入 GitHub 仓库
2. 点击 "Actions" 标签
3. 找到失败的工作流
4. 查看详细日志
5. 根据错误信息修复代码

### Q4: 如何在本地模拟 GitHub Actions？

**A:** 使用 act 工具：

```bash
# 安装 act
brew install act  # macOS
# 或
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# 运行工作流
act pull_request
```

### Q5: Husky 不生效怎么办？

**A:** 重新安装：

```bash
# 卸载
npm uninstall husky

# 重新安装
npm install husky --save-dev
npx husky install

# 重新添加钩子
npx husky add .husky/pre-commit "npm run lint:strict"
```

---

## 📈 最佳实践

### 1. 开发时
```bash
# 保存文件后自动检查（需要编辑器插件）
# VS Code: 安装 ESLint 扩展
# WebStorm: 内置支持
```

### 2. 提交前
```bash
# 手动运行检查
npm run lint:strict

# 或者让 Husky 自动运行
git commit -m "feat: xxx"
```

### 3. PR 前
```bash
# 确保通过所有检查
npm run lint:strict

# 推送代码
git push

# 等待 GitHub Actions 通过
```

### 4. 审查时
- 查看 GitHub Actions 结果
- 重点关注 ESLint 错误
- 检查命名规范是否符合要求

---

## 🎯 检查清单

确保自动化审查正常工作：

- [ ] 已安装 ESLint (`npm install`)
- [ ] 可以运行 `npm run lint`
- [ ] `.eslintrc.json` 配置正确
- [ ] GitHub Actions 工作流已创建
- [ ] PR 触发时自动运行检查
- [ ] （可选）Husky 已配置并生效

---

## 📞 需要帮助？

- 📖 查看 [DEVELOPMENT_RULES.md](./docs/DEVELOPMENT_RULES.md)
- 💡 查看 [QUICK_REFERENCE.md](./docs/QUICK_REFERENCE.md)
- 🐛 提交 Issue 提问

---

**记住：自动化检查是为了提高代码质量，不是阻碍开发！**
