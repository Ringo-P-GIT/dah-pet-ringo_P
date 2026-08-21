/**
 * ============================================================================
 * dsh-pet 宿主半侧（host half）—— 宠物插件的"后端"部分
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件运行在 DSH 的 Node 服务端（不是浏览器）。它的唯一职责是：
 *   在 DSH 的 Web 服务器上注册一个 `/pet/` 前缀的 HTTP 路由，
 *   把插件包里的动画 WebM 文件流式返回给浏览器。
 *
 * 【为什么需要它】
 *   DSH 的 `/plugins/` 路由只服务"客户端 JS bundle"，不服务视频等静态资源。
 *   所以浏览器半侧（lib/client.js）要播放动画，必须有一个专门的路由来取文件。
 *   这正是 DSH 官方提供的扩展点：`ctx.webServer.register()`。
 *
 * 【路由结构】
 *   /pet/thumb/<动画名>.webm   → 读插件包内 assets/thumb/（360×360 播放变体）
 *   /pet/full/<动画名>.webm    → 读 $DSH_HOME/pet-assets/（原始 1200×1200，需先下载）
 *
 * 【安全性】
 *   路径做了"防穿越"校验（resolveAsset）：请求里的路径规范化后必须仍在
 *   assets 根目录内，否则返回 400。防止 /pet/../../etc/passwd 这类攻击。
 *
 * ============================================================================
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// 官方 API：解析 DSH 主目录（$DSH_HOME，默认 ~/.dsh）——full 资源存放位置
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

// 插件行 id（与 cordis.patch.yml 一致）
const name = 'pet';
/** 需要注入的服务：webServer（Web 服务器路由注册表）、agents（Agent 注册表） */
const inject = ['webServer', 'agents'];

/** 本包目录（src 和安装后都适用——import.meta.url 指向 lib/，上一级即包根） */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// 需求数据文件路径
const REQSYS_DATA_DIR = join(resolveDshHome(), 'requirements');
const REQSYS_DATA_FILE = join(REQSYS_DATA_DIR, 'data.json');

function reqsysReadData() {
  try {
    return JSON.parse(readFileSync(REQSYS_DATA_FILE, 'utf-8'));
  } catch (e) {
    // 主文件损坏，尝试从备份恢复
    try {
      const backup = JSON.parse(readFileSync(REQSYS_DATA_FILE + '.backup', 'utf-8'));
      // 恢复：写回主文件
      writeFileSync(REQSYS_DATA_FILE, JSON.stringify(backup, null, 2), 'utf-8');
      console.warn('[dsh-pet] 数据文件损坏，已从备份恢复');
      return backup;
    } catch (e2) {
      // 备份也损坏，返回默认结构
      return { requirements: [], tasks: [], rules: [
        { keywords: ['OA'], tag: 'OA' },
        { keywords: ['qsale', '销售'], tag: '销售' },
        { keywords: ['预算系统'], tag: '预算系统' },
      ]};
    }
  }
}

function reqsysWriteData(data) {
  const content = JSON.stringify(data, null, 2);
  if (!existsSync(REQSYS_DATA_DIR)) {
    mkdirSync(REQSYS_DATA_DIR, { recursive: true });
  }
  writeFileSync(REQSYS_DATA_FILE, content, 'utf-8');
  writeFileSync(REQSYS_DATA_FILE + '.backup', content, 'utf-8');
}

/** 路由前缀：/pet/thumb/<name>.webm、/pet/full/<name>.webm */
const ROUTE_PREFIX = '/pet';

/** 不同扩展名对应的 Content-Type 映射 */
const MIME = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/**
 * 规范化并校验请求路径，确保它在 assets 根目录内（防路径穿越）。
 * @param root - assets 根目录（绝对路径）
 * @param rel  - 解码后的、路由前缀之后的路径片段
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined
 */
function resolveAsset(root, rel) {
  if (rel.length === 0) return undefined;
  // join + normalize 得到规范化路径（处理 ..、./、多余分隔符）
  const candidate = normalize(join(root, rel));
  // 根目录带分隔符的前缀，用于判断候选路径是否真的在根目录内
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  // 候选路径必须等于根目录或以"根目录/"开头，否则是穿越（如 ../lib/index.js）
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/**
 * 宿主插件主体：注册 `/pet` 前缀路由。
 * @param ctx    - 插件上下文；ctx.webServer 是 Web 服务器服务
 * @param config - 本行的配置（来自 patch 树）
 */
function apply(ctx, config) {
  // 两个资源根：
  // - thumbRoot：插件包内 assets/thumb/（360×360 播放变体，随包发布，一定存在）
  // - fullRoot ：$DSH_HOME/pet-assets/（原始母版，需手动下载，可能不存在）
  const thumbRoot = join(PACKAGE_ROOT, 'assets', 'thumb');
  const fullRoot = config.fullRoot ?? join(resolveDshHome(), 'pet-assets');
  let petState; // 状态机持久变量

  // ctx.effect 包裹：插件卸载时自动注销路由（官方生命周期管理）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',     // 前缀路由：匹配 /pet 以及 /pet/xxx
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // 去掉 /pet/ 前缀并 URL 解码
      const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));

      // ---- 状态查询端点 ----
      if (rest === 'pet-status' || rest === 'state') {
        try {
          // 取所有 Agent，只要有一个在 running 就显示工作中
          const agents = ctx.agents.list();
          const running = agents.some(a => a?.status === 'running');
          const status = running ? 'running' : 'idle';

          // 映射 DSH Agent 状态 → 宠物状态（带状态机）
          const now = Date.now();
          if (!petState) petState = { prevStatus: 'idle', prevState: 'IDLE', changeTime: now };

          let state = 'IDLE';
          let message = '';

          if (status === 'running') {
            if (petState.prevStatus !== 'running') {
              // idle → running：THINKING 阶段
              state = 'THINKING';
              message = '正在认真思考下一步呢';
              petState.changeTime = now;
            } else {
              // 已经在 running 状态
              const elapsed = now - petState.changeTime;
              if (petState.prevState === 'THINKING' && elapsed > 3000) {
                // 思考超过 3 秒 → 切换为工作中
                state = 'WORKING';
                message = '正在处理任务呢';
                petState.changeTime = now;
              } else if (petState.prevState === 'THINKING') {
                state = 'THINKING';
                message = '正在认真思考下一步呢';
              } else {
                state = 'WORKING';
                message = '正在处理任务呢';
              }
            }
          } else {
            // idle
            if (petState.prevStatus === 'running') {
              // running → idle：SUCCESS 阶段
              state = 'SUCCESS';
              message = '任务完成咯~';
              petState.changeTime = now;
            } else if (petState.prevState === 'SUCCESS') {
              const elapsed = now - petState.changeTime;
              if (elapsed > 4000) {
                state = 'IDLE';
                message = '';
              } else {
                state = 'SUCCESS';
                message = '任务完成咯~';
              }
            } else {
              state = 'IDLE';
              message = '';
            }
          }

          petState.prevStatus = status;
          petState.prevState = state;

          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-cache',
          });
          res.end(JSON.stringify({ state, message, detail: '' }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ state: 'IDLE', message: '', detail: '', error: e.message }));
        }
        return;
      }

      // ---- 愿望清单 API ----
      if (rest.startsWith('api/requirements')) {
        const id = rest.split('/')[2]; // api/requirements/:id
        if (req.method === 'GET') {
          const data = reqsysReadData();
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data.requirements || []));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const items = JSON.parse(body);
              const data = reqsysReadData();
              const rules = data.rules || [];
              const saved = [];
              for (const item of items) {
                let polished = (item.polished || item.original || '').trim();
                if (polished && !/[。.!？!?]/.test(polished.slice(-1))) polished += '。';
                const text = (item.original + ' ' + (item.polished || '')).toLowerCase();
                const autoTags = [];
                for (const rule of rules) {
                  for (const kw of (rule.keywords || [])) {
                    if (text.indexOf(kw.toLowerCase()) !== -1) {
                      if (autoTags.indexOf(rule.tag) === -1) autoTags.push(rule.tag);
                    }
                  }
                }
                const combinedTags = item.tags || [];
                for (const t of autoTags) {
                  if (combinedTags.indexOf(t) === -1) combinedTags.push(t);
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
                };
                data.requirements.push(req);
                saved.push(req);
              }
              reqsysWriteData(data);
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true, requirements: saved }));
            } catch (e) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        if (req.method === 'PUT' && id) {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const updates = JSON.parse(body);
              const data = reqsysReadData();
              const r = data.requirements.find(r => r.id === id);
              if (!r) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
              if (updates.progress !== undefined) r.progress = updates.progress;
              if (updates.version !== undefined) r.version = updates.version;
              if (updates.reason !== undefined) r.reason = updates.reason;
              if (updates.polished !== undefined) r.polished = updates.polished;
              if (updates.tags !== undefined) r.tags = updates.tags;
              reqsysWriteData(data);
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        if (req.method === 'DELETE' && id) {
          const data = reqsysReadData();
          const idx = data.requirements.findIndex(r => r.id === id);
          if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
          data.requirements.splice(idx, 1);
          reqsysWriteData(data);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      if (rest === 'api/rules') {
        if (req.method === 'GET') {
          const data = reqsysReadData();
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data.rules || []));
          return;
        }
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const newRules = JSON.parse(body);
              const data = reqsysReadData();
              data.rules = newRules;
              reqsysWriteData(data);
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      // ---- 未竟任务 API ----
      if (rest === 'api/tasks') {
        if (req.method === 'GET') {
          const data = reqsysReadData();
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data.tasks || []));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const item = JSON.parse(body);
              const data = reqsysReadData();
              if (!data.tasks) data.tasks = [];
              const task = {
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
                timestamp: new Date().toISOString(),
                description: item.description || '',
                deadline: item.deadline || '',
                status: item.status || '未开始',
              };
              data.tasks.push(task);
              reqsysWriteData(data);
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true, task: task }));
            } catch (e) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }
      if (rest.startsWith('api/tasks/')) {
        const id = rest.split('/')[2];
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const updates = JSON.parse(body);
              const data = reqsysReadData();
              const t = (data.tasks || []).find(t => t.id === id);
              if (!t) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
              if (updates.description !== undefined) t.description = updates.description;
              if (updates.deadline !== undefined) t.deadline = updates.deadline;
              if (updates.status !== undefined) t.status = updates.status;
              reqsysWriteData(data);
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        if (req.method === 'DELETE') {
          const data = reqsysReadData();
          if (!data.tasks) data.tasks = [];
          const idx = data.tasks.findIndex(t => t.id === id);
          if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
          data.tasks.splice(idx, 1);
          reqsysWriteData(data);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      // ---- 资源路由（thumb / full）----
      // 第一段是 scope：thumb 或 full
      const [scope, ...nameParts] = rest.split('/');
      if (scope !== 'thumb' && scope !== 'full') {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-pet: expected /pet/{thumb|full}/<file>');
        return;
      }
      // 剩余部分是文件名（可能含空格/中文，原样保留）
      const fileName = nameParts.join('/');
      const root = scope === 'thumb' ? thumbRoot : fullRoot;
      // 防穿越校验
      const file = resolveAsset(root, fileName);
      if (file === undefined) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-pet: invalid path');
        return;
      }
      // 文件不存在：full 未下载 vs thumb 缺失给不同提示
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(scope === 'full'
          ? `dsh-pet: original asset not downloaded yet — run the fetch-assets script to populate ${fullRoot}`
          : 'dsh-pet: asset not found');
        return;
      }
      // 按扩展名定 Content-Type，附 Content-Length（浏览器可显示进度）
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const { size } = await stat(file);
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': size,
        // 缓存 1 小时：动画是静态文件，重复播放直接命中缓存
        'cache-control': 'public, max-age=3600',
      });
      // 流式返回（大文件不占内存）
      const stream = createReadStream(file);
      stream.on('error', () => {
        res.destroy();
      });
      stream.pipe(res);
    },
  }), 'dsh-pet: /pet asset route');
}

// 导出插件三件套（Cordis Loader 需要）
export { apply, inject, name };
