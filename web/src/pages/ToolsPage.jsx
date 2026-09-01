import React from 'react'

const TOOLS = [
  {
    id: 'paint',
    href: '#/paint',
    icon: '🎨',
    title: 'AI 绘画',
    description: '描述画面，生成图片'
  },
  {
    id: 'resume',
    href: '#/resume',
    icon: '📄',
    title: '简历',
    description: '查看我的简历'
  }
]

export default function ToolsPage() {
  return <section className="tools-page">
    <div className="tools-grid">
      {TOOLS.map(tool => <a key={tool.id} href={tool.href} className="tool-square" aria-label={tool.title}>
        <span className="tool-square-icon">{tool.icon}</span>
        <strong>{tool.title}</strong>
        <small>{tool.description}</small>
      </a>)}
    </div>
  </section>
}
