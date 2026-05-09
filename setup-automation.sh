#!/bin/bash

# ==========================================
# FavGallery - 自动化审查设置脚本
# 用途：一键安装和配置自动化审查工具
# ==========================================

echo "🚀 FavGallery 自动化审查设置"
echo "================================"
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"
echo "✅ npm 版本: $(npm -v)"
echo ""

# 询问是否安装依赖
read -p "是否安装 ESLint 依赖？(y/n): " install_deps
if [ "$install_deps" = "y" ] || [ "$install_deps" = "Y" ]; then
    echo ""
    echo "📦 正在安装依赖..."
    npm install
    echo ""
    echo "✅ 依赖安装完成"
else
    echo "⏭️  跳过依赖安装"
fi

echo ""
echo "================================"
echo "📋 已创建的文件："
echo "================================"
echo "✅ .eslintrc.json - ESLint 配置"
echo "✅ .eslintignore - 忽略文件配置"
echo "✅ package.json - 项目配置"
echo "✅ .github/workflows/code-quality.yml - GitHub Actions"
echo "✅ docs/AUTOMATED_REVIEW_SETUP.md - 使用指南"
echo "✅ docs/AUTOMATION_SUMMARY.md - 实施报告"
echo ""

echo "================================"
echo "🎯 下一步操作："
echo "================================"
echo ""
echo "1️⃣  测试 ESLint："
echo "   npm run lint"
echo ""
echo "2️⃣  自动修复问题："
echo "   npm run lint:fix"
echo ""
echo "3️⃣  阅读完整文档："
echo "   cat docs/AUTOMATED_REVIEW_SETUP.md"
echo ""
echo "4️⃣  （可选）配置 Husky："
echo "   npm install husky lint-staged --save-dev"
echo "   npx husky install"
echo ""

echo "================================"
echo "💡 提示："
echo "================================"
echo "- VS Code 用户：安装 ESLint 扩展可实时检查"
echo "- WebStorm 用户：内置支持 ESLint"
echo "- 提交 PR 时会自动运行 GitHub Actions"
echo ""

echo "✅ 设置完成！开始编写符合规范的代码吧！"
echo ""
