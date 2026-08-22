# dah-pet-ringo_P

桌面宠物 + 行迹 & 未竟（需求 & 任务管理），集成到 DSH Web GUI。

## 功能总览

### 🐾 桌面宠物

- **WebM 动画** — 宠物休闲动画（基于 WebM 序列帧）
- **状态机** — 跟随 DSH Agent 状态自动切换：
  - `THINKING` → `WORKING` → `SUCCESS` → `IDLE`
  - 气泡文字随状态变化（思考中/工作中/任务完成咯~）
- **拖拽** — 宠物可拖拽到任意位置
- **余额气泡** — 点击触发随机台词

### 📋 行迹（需求管理系统）

#### 需求录入
- 输入自然语言需求，自动拆分为多条
- **自动标签** — 按配置的标签规则（关键词匹配）自动打标签
- **自动润色** — 每条需求自动生成 polished 描述
- 支持描述编辑（点击文本弹出编辑框）

#### 列表视图
- 表格展示：编号、时间、描述、标签、当前进展、版本、废弃原因
- **活动中 / 已归档** 页签切换
- 已归档项只读，显示归档时间

#### 筛选
- **标签** — 多选下拉（复选框），可选值仅显示当前页签的数据
- **当前进展** — 多选下拉（未处理/方案设计/已发布/废弃）
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
- 进展：未处理 → 方案设计 → 已发布 / 废弃
- 版本号管理
- 废弃原因记录

#### 标签规则配置
- ⚙ 配置标签 — 管理关键词 → 标签映射规则
- 支持新增/删除规则

#### 导出
- **CSV 导出** — 含 BOM，兼容 Excel 中文
- **JSON 导出** — 原始数据

### 📝 未竟（任务管理系统）

#### 任务录入
- 输入描述 + 截止日期，生成待办
- 支持描述编辑、截止日期修改（原生日期选择器）

#### 列表视图
- 表格展示：编号、描述、记录时间、截止日期、完成情况
- **活动中 / 已归档** 页签切换
- 已归档项只读，显示归档时间

#### 筛选
- **完成情况** — 多选（未开始/进行中/已完成）
- **搜索** — 按描述关键词搜索
- **重置** — 一键清空

#### 批量操作
- **复选框勾选** + 批量归档/重启
- 重启时状态重置为「未开始」

#### 导出
- **CSV 导出** — 含 BOM
- **JSON 导出**

### 🔄 归档系统

- 已归档项自动记录 `archivedAt` 时间戳
- 活动中页签隐藏归档时间列，已归档页签显示
- 归档/重启按钮切换上下文

### 🎨 界面

- **渐变边框卡片** — indigo → purple → gold 四边渐变
- **统一按钮样式** — 紫色主题按钮
- **模态编辑框** — 居中弹出，自动调整大小
- **确认对话框** — 批量操作前确认

## 架构

### 技术栈

| 层 | 技术 |
|----|------|
| 宿主插件 | Node.js (Cordis) |
| 浏览器插件 | React (h JSX) |
| 数据存储 | JSON 文件（自动备份） |
| 动画 | WebM 视频 |
| 版本控制 | isomorphic-git → GitHub |

### 文件结构

```
dsh-pet/
├── lib/
│   ├── index.js        # 宿主插件（路由、数据 API、状态机）
│   └── client.js       # 浏览器插件（UI、交互）
├── cordis.patch.yml    # DSH 挂载声明
├── package.json
└── README.md
```

### 数据 API

所有 API 通过 `/pet/` 前缀路由（由 DSH 代理）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/pet/pet-status` | 宠物状态查询 |
| GET | `/pet/api/requirements` | 获取所有需求 |
| POST | `/pet/api/requirements` | 新增需求（批量） |
| PUT | `/pet/api/requirements/:id` | 更新需求 |
| DELETE | `/pet/api/requirements/:id` | 删除需求 |
| GET | `/pet/api/tasks` | 获取所有任务 |
| POST | `/pet/api/tasks` | 新增任务 |
| PUT | `/pet/api/tasks/:id` | 更新任务 |
| DELETE | `/pet/api/tasks/:id` | 删除任务 |
| GET | `/pet/api/rules` | 获取标签规则 |
| PUT | `/pet/api/rules` | 保存标签规则 |

### 数据存储

- 文件：`~/.dsh/requirements/data.json`
- 备份：`~/.dsh/requirements/data.json.backup`
- 自动恢复：主文件损坏时自动从备份恢复

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

确保 `cordis.patch.yml` 已位于包根目录，内容：

```yaml
- insert:
    - id: pet
      name: 'dsh-pet'
      config:
        size: 260
        position: bottom-right
```

### 启动

1. 重启 DSH
2. 页面右下角出现宠物图标
3. 点击宠物 → 弹出行迹/未竟对话框

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
# 重启 DSH 或刷新页面（仅 client.js 变更时只需刷新）
```

## 废弃

- `reqsys-server.js` — 旧版独立服务器，已废弃，功能已合并到 `index.js`