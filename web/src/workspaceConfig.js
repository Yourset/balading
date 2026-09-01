// 主电脑（运行 DSH 的那台机器）上，各内置助手会话使用的默认工作目录。
//
// 这些路径因人而异，所以不写死在代码里，而是构建期通过 Vite 环境变量注入：
//   1) 复制 web/.env.example 为 web/.env.local
//   2) 填入你自己主电脑上的目录，例如 VITE_DSH_WORKSPACE=D:\\work\\ai
//   3) 重新构建前端（npm run build）
//
// 留空时助手会话不指定 cwd，由 DSH 侧使用它自己的默认工作目录。
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

// 通用助手（私人助手 / 健身助手 / 闪念整理）的工作目录。
export const DSH_WORKSPACE = env.VITE_DSH_WORKSPACE || ''

// 「优化总管」这类针对本项目自身的助手，工作目录默认指向本仓库 checkout。
export const DSH_PROJECT_DIR = env.VITE_DSH_PROJECT_DIR || DSH_WORKSPACE
