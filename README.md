# dah-pet-ringo_P

桌面宠物 + 行迹 & 未竟（需求 & 任务管理），集成到 DSH Web GUI。

## 功能总览

### 🐾 桌面宠物

- **WebM 动画** — 双缓冲视频渲染，40+ 动画序列（待机呼吸、休闲动作、点击回应等）
- **状态机** — 跟随 DSH Agent 状态自动切换，四种状态：
  - `THINKING` → 轻快记录（蓝气泡）
  - `WORKING` → 写代码（紫气泡）
  - `SUCCESS` → 开心跃动（绿气泡，播放一次后回到 IDLE）
  - `IDLE` → 随机休闲动画
- **拖拽** — 可拖拽到屏幕任意位置，松开后固定
- **点击** — 随机触发点击回应动画
- **双击** — 打开行迹/未竟对话框
- **屏幕漫游** — 随机横向移动，带动画过渡
- **余额气泡** — 底部显示文字气泡（状态/随机台词）

### 📋 行迹（需求管理系统）

#### 需求录入

- 输入自然语言需求，自动拆分为多条
- 支持编号列表格式（`1.` `2.` `-` `•` `(1)` 等）
- **自动标签** — 按配置的标签规则（关键词匹配）自动分类
- **自动润色** — 每条需求自动生成 polished 描述
- **预览确认** — 提交前可编辑描述、增删标签

#### 数据模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 时间戳 + 随机 |
| timestamp | ISO | 记录时间 |
| original | string | 原始输入 |
| polished | string | 润色后描述 |
| tags | string[] | 标签列表 |
| progress | enum | 未处理/方案设计/已发布/废弃 |
| version | string | 版本号 |
| reason | string | 废弃原因 |
| archived | boolean | 归档标记 |
| archivedAt | ISO | 归档时间 |

#### 列表视图

- 表格展示：编号、复选框、记录时间、需求描述、标签、当前进展、版本、废弃原因、归档时间、操作
- **分页** — 每页 15 条
- **活动中 / 已归档** 页签切换
- 已归档项只读，显示归档时间列

#### 筛选

- **标签** — 多选下拉（复选框），可选值仅显示当前页签的数据
- **当前进展** — 多选下拉
- **版本** — 多选下拉，可选值仅显示当前页签的数据
- **搜索** — 按描述关键词搜索
- **重置** — 一键清空所有筛选条件

#### 批量操作

- **复选框勾选** — 表头全选/取消，逐行勾选
- **批量归档** — 活动中页签下，选中后一键归档
- **批量重启** — 已归档页签下，选中后一键恢复（进度重置为「未处理」）
- **批量指令** — 自然语言指令解析，支持三种动作：
  - `设版本` — `OA标签的需求，放在v5.3版本`
  - `归档` — `归档v5.3版本的需求`
  - `改进展` — `OA标签，方案设计的需求，进展改为已发布`
  - 弹出确认框，可勾选排除

#### 状态管理

- 进展可切换：未处理 → 方案设计（需输入版本号）→ 已发布 | 废弃（需输入原因）
- 版本号标签：蓝色=设计中，绿色=已发布
- 废弃原因红色显示

#### 标签规则配置

- ⚙ 配置标签 — 管理关键词 → 标签映射规则
- 支持新增/删除规则
- 客户端和服务端双保险自动打标签

#### 导出

- **CSV 导出** — 含 UTF-8 BOM，兼容 Excel 中文
- **JSON 导出** — 原始数据

### 📝 未竟（任务管理系统）

#### 任务录入

- 输入描述 + 截止日期，生成待办
- 支持描述编辑、截止日期修改（原生日期选择器）

#### 数据模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 时间戳 + 随机 |
| timestamp | ISO | 记录时间 |
| description | string | 任务描述 |
| deadline | date | 截止日期 |
| status | enum | 未开始/进行中/已完成 |
| archived | boolean | 归档标记 |
| archivedAt | ISO | 归档时间 |

#### 列表视图

- 表格展示：编号、复选框、待办描述、记录时间、截止日期、完成情况、归档时间、操作
- 截止日期 < 2天且未完成 → 红色高亮
- **活动中 / 已归档** 页签切换
- 已归档项只读，显示归档时间列

#### 筛选

- **完成情况** — 多选（未开始/进行中/已完成）
- **搜索** — 按描述关键词搜索
- **重置** — 一键清空

#### 批量操作

- 复选框勾选 + 批量归档/重启
- 重启时状态重置为「未开始」

#### 导出

- **CSV 导出** — 含 UTF-8 BOM
- **JSON 导出**

### 🔄 归档系统

- 归档时自动记录 `archivedAt` 时间戳
- 活动中页签隐藏归档时间列，已归档页签显示
- 归档/重启按钮随页签切换上下文
- 数据自动备份，支持崩溃恢复

### 🎨 界面

- **渐变边框卡片** — 四边 indigo → purple → gold 渐变
- **紫色主题按钮** — 统一风格
- **模态编辑框** — 居中弹出，自动调整大小
- **确认对话框** — 批量操作前确认
- 响应式设计，支持 `maxWidth: 95vw`

## 架构

### 技术栈

| 层 | 技术 |
|----|------|
| 宿主插件 | Node.js (Cordis) |
| 浏览器插件 | React (h JSX) |
| 数据存储 | JSON 文件 + 自动备份 |
| 动画 | WebM 视频 + 双缓冲渲染 |
| 版本控制 | isomorphic-git → GitHub |

### 文件结构

```
dsh-pet/
├── lib/
│   ├── index.js        # 宿主插件（路由、数据 API、状态机）
│   └── client.js       # 浏览器插件（UI、交互）
├── cordis.patch.yml    # DSH 挂载声明
├── package.json
├── README.md
└── reqsys-server.js    # [已废弃] 旧版独立服务器
```

### 数据 API

所有 API 通过 `/pet/` 前缀路由（由 DSH 代理）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/pet/pet-status` | 宠物状态（状态机） |
| GET | `/pet/thumb/:name` | 动画缩略版 WebM |
| GET | `/pet/full/:name` | 动画原版 WebM |
| GET | `/pet/api/requirements` | 获取所有需求 |
| POST | `/pet/api/requirements` | 批量新增需求 |
| PUT | `/pet/api/requirements/:id` | 更新需求字段 |
| DELETE | `/pet/api/requirements/:id` | 删除需求 |
| GET | `/pet/api/tasks` | 获取所有任务 |
| POST | `/pet/api/tasks` | 新增任务 |
| PUT | `/pet/api/tasks/:id` | 更新任务字段 |
| DELETE | `/pet/api/tasks/:id` | 删除任务 |
| GET | `/pet/api/rules` | 获取标签规则 |
| PUT | `/pet/api/rules` | 保存标签规则 |

### 数据存储

- 主文件：`~/.dsh/requirements/data.json`
- 备份文件：`~/.dsh/requirements/data.json.backup`
- 自动恢复：主文件损坏时自动从备份恢复
- 双备份损坏：返回默认规则结构

## 安装

### 前置条件

- DSH 已安装并运行
- 已安装 dsh-pet npm 包：

```bash
cd ~/.dsh/profiles/web
npm install @deepseek-ai/dsh-pet
```

或手动将文件放入 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/`

### 配置

确保 `cordis.patch.yml` 已位于包根目录：

```yaml
- insert:
    - id: pet
      name: 'dsh-pet'
      config:
        size: 260
        position: bottom-right
```

### 启动

1. 重启 DSH（或刷新页面，仅 client.js 变更时）
2. 页面右下角出现宠物图标
3. 双击宠物 → 弹出行迹/未竟对话框

## 开发

### 本地仓库

```bash
git clone https://github.com/Ringo-P-GIT/dah-pet-ringo_P
cd dah-pet-ringo_P
```

### 更新到 DSH

```bash
# 复制到 DSH 插件目录
cp client.js ~/.dsh/profiles/web/node_modules/dsh-pet/lib/
cp index.js ~/.dsh/profiles/web/node_modules/dsh-pet/lib/
# 重启 DSH（index.js 变更需要）或刷新页面（仅 client.js 变更）
```

### 提交到 GitHub

```bash
# 使用 isomorphic-git（Node.js 环境）
# 参见 lib/index.js 中 git push 逻辑
```

## 废弃

- `reqsys-server.js` — 旧版独立需求服务器，功能已合并到 `index.js`