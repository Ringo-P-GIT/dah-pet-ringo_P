// 需求录入系统 - 独立服务器
// 运行: node reqsys-server.js
// 访问: http://localhost:3456

const http = require('http')
const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(process.env.DSH_HOME || require('os').homedir() + '/.dsh', 'requirements', 'data.json')
const PORT = 3456

// 确保目录存在
const dir = path.dirname(DATA_FILE)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch (e) {
    return { requirements: [], rules: [
      { keywords: ['OA'], tag: 'OA' },
      { keywords: ['qsale', '销售'], tag: '销售' },
      { keywords: ['预算系统'], tag: 'budget' },
    ]}
  }
}

function writeData(data) {
  const content = JSON.stringify(data, null, 2)
  fs.writeFileSync(DATA_FILE, content, 'utf-8')
  fs.writeFileSync(DATA_FILE + '.backup', content, 'utf-8')
}

function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch (e) {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/') {
    serveFile(res, __dirname + '/reqsys.html', 'text/html; charset=utf-8')
  } else if (req.method === 'GET' && pathname === '/api/requirements') {
    const data = readData()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data.requirements || []))
  } else if (req.method === 'POST' && pathname === '/api/requirements') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const items = JSON.parse(body)
        const data = readData()
        const rules = data.rules || []
        const saved = []
        for (const item of items) {
          // 自动润色：末尾加句号
          let polished = (item.polished || item.original || '').trim()
          if (polished && !/[。.!？!?]/.test(polished.slice(-1))) polished += '。'

          // 自动标签分类
          const text = (item.original + ' ' + (item.polished || '')).toLowerCase()
          const autoTags = []
          for (const rule of rules) {
            for (const kw of (rule.keywords || [])) {
              if (text.indexOf(kw.toLowerCase()) !== -1) {
                if (autoTags.indexOf(rule.tag) === -1) autoTags.push(rule.tag)
              }
            }
          }
          // 合并客户端传入的标签 + 自动标签
          const combinedTags = item.tags || []
          for (const t of autoTags) {
            if (combinedTags.indexOf(t) === -1) combinedTags.push(t)
          }

          const req = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
            timestamp: new Date().toISOString(),
            original: item.original || '',
            polished: polished,
            tags: combinedTags,
            progress: '未处理',
            version: '',
            reason: ''
          }
          data.requirements.push(req)
          saved.push(req)
        }
        writeData(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, requirements: saved }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  } else if (req.method === 'PUT' && pathname.startsWith('/api/requirements/')) {
    const id = pathname.split('/')[3]
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const updates = JSON.parse(body)
        const data = readData()
        const r = data.requirements.find(r => r.id === id)
        if (!r) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
        if (updates.progress !== undefined) r.progress = updates.progress
        if (updates.version !== undefined) r.version = updates.version
        if (updates.reason !== undefined) r.reason = updates.reason
        writeData(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  } else if (req.method === 'GET' && pathname === '/api/rules') {
    const data = readData()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data.rules || []))
  } else if (req.method === 'PUT' && pathname === '/api/rules') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const newRules = JSON.parse(body)
        const data = readData()
        data.rules = newRules
        writeData(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`需求录入系统已启动: http://localhost:${PORT}`)
  console.log(`数据文件: ${DATA_FILE}`)
})