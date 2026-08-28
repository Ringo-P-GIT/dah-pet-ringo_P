/**
 * ============================================================================
 * dsh-pet 浏览器半侧（browser half）—— 宠物插件的"前端"部分
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件是宠物在浏览器里运行的代码。它：
 *   1. 以官方规定的"客户端 bundle 形态"注册自己（window.__ModuleLoader__.load）
 *   2. 把宠物组件挂到 DSH 界面的 `shell.overlay` 槽位（右下角的浮动层）
 *   3. 负责宠物的所有视觉与交互：播放动画、随机行为、点击/拖拽、屏幕漫游
 *   4. 轮询 /pet/state 获取 DSH Agent 状态，驱动动画切换（8 种状态）
 *
 * 【8 种状态 + 动作 + 自然文案】
 *   IDLE      空闲    → 保持现有随机动画链
 *   THINKING  思考中  → '轻快记录'
 *   WORKING   工作中  → '写代码'
 *   SEARCHING 查找中  → '深度思考碎碎念'
 *   WAITING   等待确认 → '东张西望'
 *   SUCCESS   完成    → '点击回应 - 开心跃动'（脉冲，播一次回空闲）
 *   ERROR     错误    → '被吓一跳（炸毛）'（脉冲，播一次回空闲）
 *   STOPPED   已停止  → '原地小憩沉眠'
 *
 * ============================================================================
 */
window.__ModuleLoader__.load({
	// 插件唯一 ID，必须与 package.json 里声明的一致
	id: 'dsh-pet',

	// factory：浏览器加载本 bundle 时执行，返回插件的导出
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ---- 从 DSH 外壳拿 React（不能自己打包） ----
		let react = require('react');
		let { useEffect, useRef, useState } = react;
		// jsx 是 React 18 的新 JSX 转换函数，这里起个别名 h 方便书写
		let { jsx: h } = require('react/jsx-runtime');

		// ============================================================================
		// 内联 CSS —— 注入一次，官方插件标准做法
		// ============================================================================
		const css = [
			// 根容器：fixed 固定定位、层级 40（在界面之上）、整体点击穿透（不挡界面操作）、禁止选中
			'.dsh-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
			// 右下角默认位置（right:24px 距右缘、bottom:0 贴底）
			'.dsh-pet-root[data-corner="bottom-right"]{right:24px;bottom:0}',
			// 左下角位置
			'.dsh-pet-root[data-corner="bottom-left"]{left:24px;bottom:0}',
			// 舞台：16:9（--dsh-pet-size 为宽度，默认 462px=高度260；高度自动 = 宽度×9/16），本身不响应鼠标
			'.dsh-pet-stage{position:relative;width:var(--dsh-pet-size,462px);height:calc(var(--dsh-pet-size,462px)*9/16);pointer-events:none}',
			// 视频：铺满舞台、保持比例，**pointer-events:none 完全穿透**——
			// 交互统一由覆盖 HIT_BOX 区域的 .dsh-pet-hit 层负责，透明区域点击直达下层 UI。
			'.dsh-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}',
			// 显示中的视频（is-front 类）
			'.dsh-pet-video.is-front{opacity:1}',
			// 命中层：覆盖人物区域（HIT_BOX），是唯一可交互区域；光标跟随 + 拖拽抓取
			'.dsh-pet-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}',
			'.dsh-pet-hit.dragging{cursor:grabbing}',
			// 无障碍：用户系统开启"减少动态效果"时关闭过渡动画
			'@media (prefers-reduced-motion: reduce){.dsh-pet-video{transition:none}}',
			// 状态气泡
			'.dsh-pet-state-bubble{position:absolute;left:50%;bottom:calc(var(--dsh-pet-size,462px)*9/16 + 12px);transform:translateX(-50%);max-width:min(320px,70vw);padding:8px 16px;background:rgba(30,30,30,.82);color:#fff;font-size:15px;font-weight:500;line-height:1.4;border-radius:12px;border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;white-space:normal;text-align:center;z-index:5;animation:dsh-pet-bubble-in .18s ease-out;backdrop-filter:blur(6px)}',
			// 状态气泡小尾巴
			'.dsh-pet-state-bubble::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:7px solid transparent;border-top-color:rgba(30,30,30,.82)}',
			// 状态气泡：不同状态的颜色
			'.dsh-pet-state-bubble.state-thinking{background:rgba(40,80,160,.85);border-color:rgba(100,160,255,.3)}',
			'.dsh-pet-state-bubble.state-thinking::after{border-top-color:rgba(40,80,160,.85)}',
			'.dsh-pet-state-bubble.state-working{background:rgba(80,60,140,.85);border-color:rgba(160,120,255,.3)}',
			'.dsh-pet-state-bubble.state-working::after{border-top-color:rgba(80,60,140,.85)}',
			'.dsh-pet-state-bubble.state-waiting{background:rgba(160,120,40,.85);border-color:rgba(255,200,80,.3)}',
			'.dsh-pet-state-bubble.state-waiting::after{border-top-color:rgba(160,120,40,.85)}',
			'.dsh-pet-state-bubble.state-success{background:rgba(40,140,60,.85);border-color:rgba(80,220,120,.3)}',
			'.dsh-pet-state-bubble.state-success::after{border-top-color:rgba(40,140,60,.85)}',
			'.dsh-pet-state-bubble.state-error{background:rgba(180,50,50,.88);border-color:rgba(255,100,100,.3)}',
			'.dsh-pet-state-bubble.state-error::after{border-top-color:rgba(180,50,50,.88)}',
			// 余额气泡（白底黑字，与状态气泡区分）
			'.dsh-pet-bubble{position:absolute;left:50%;bottom:calc(var(--dsh-pet-size,462px)*9/16 + 12px);transform:translateX(-50%);max-width:min(320px,70vw);padding:10px 18px;background:#fff;color:#111;font-size:17px;font-weight:600;line-height:1.5;border-radius:14px;border:1px solid rgba(0,0,0,.18);box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none;white-space:normal;text-align:center;z-index:5;animation:dsh-pet-bubble-in .18s ease-out}',
			'.dsh-pet-bubble::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:8px solid transparent;border-top-color:#fff}',
			'.dsh-pet-bubble.is-error{background:#ffebeb;color:#111;border-color:rgba(220,60,60,.45)}',
			'.dsh-pet-bubble.is-error::after{border-top-color:#ffebeb}',
			'@keyframes dsh-pet-bubble-in{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
			'@media (prefers-reduced-motion: reduce){.dsh-pet-bubble{animation:none}}',
			'@media (prefers-reduced-motion: reduce){.dsh-pet-state-bubble{animation:none}}',
		].join('\n');
		const cssTag = 'dsh-pet/style-v2.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-pet';
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ============================================================================
		// 需求录入系统 CSS
		// ============================================================================
		const reqsysCss = [
			'.reqsys-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;overflow-y:auto}',
			'.reqsys-card-wrap{background:linear-gradient(135deg,#526aa8,#8ea5da,#c5a468,#8ea5da,#526aa8);padding:4px;border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.3)}',
			'.reqsys-card{background:#fff;border-radius:14px;padding:28px 32px;color:#111}',
			'.reqsys-card h2{color:#172347;margin:0 0 16px 0;font-size:20px;font-weight:600}',
			'.reqsys-card textarea{width:100%;min-height:100px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;line-height:1.5;resize:vertical;box-sizing:border-box;font-family:inherit}',
			'.reqsys-card textarea:focus{outline:0;border-color:#4a7cff;box-shadow:0 0 0 3px rgba(74,124,255,.15)}',
			'.reqsys-tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}',
			'.reqsys-tag{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500;background:#e8f0fe;color:#1a5cc8}',
			'.reqsys-preview-item{border:1px solid #eee;border-radius:10px;padding:14px;margin-bottom:12px}',
			'.reqsys-preview-item .item-index{font-size:13px;font-weight:600;color:#4a7cff;margin-bottom:6px}',
			'.reqsys-table{width:100%;border-collapse:collapse;font-size:13px}',
			'.reqsys-table th{text-align:left;padding:8px 10px;border-bottom:2px solid #eee;font-weight:600;color:#555;white-space:nowrap}',
			'.reqsys-table td{padding:8px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle}',
			'.reqsys-table tr:hover td{background:#f8f9ff}',
			'.reqsys-empty{text-align:center;padding:40px 20px;color:#999}',
			'.reqsys-filter-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-start}',
			'.reqsys-filter-bar .filter-group{display:flex;flex-direction:column;gap:4px}',
			'.reqsys-filter-bar .filter-label{font-size:11px;color:#888;font-weight:500}',
			'.reqsys-filter-bar .filter-count{font-size:12px;color:#888;align-self:flex-end}',
			'.reqsys-version-tag{font-size:11px;font-weight:500;padding:2px 6px;border-radius:4px;display:inline-block;cursor:pointer}',
			'.reqsys-version-tag.design{background:#e3f2fd;color:#1565c0}',
			'.reqsys-version-tag.released{background:#e8f5e9;color:#2e7d32}',
			'.reqsys-reason-text{font-size:11px;color:#c62828;cursor:pointer}',
			'.reqsys-subtitle{font-size:13px;color:#666;margin:-8px 0 12px 0}',
			'.reqsys-maid-btn{background:#fff;border:1px solid rgba(71,91,145,.3);border-radius:8px;padding:8px 20px;font-size:14px;cursor:pointer;color:#172347;transition:all .15s}',
			'.reqsys-maid-btn:hover{background:rgba(103,126,183,.12);border-color:rgba(71,91,145,.5)}',
			'.reqsys-maid-btn.primary{background:#526aa8;color:#fff;border-color:#526aa8}',
			'.reqsys-maid-btn.primary:hover{background:#405a99}',
			'.reqsys-maid-btn.primary:disabled{background:#8a94aa;border-color:#8a94aa;cursor:default}',
		].join('\n');
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="reqsys"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-pet';
			tag.dataset.pluginCss = 'reqsys';
			tag.textContent = reqsysCss;
			document.head.appendChild(tag);
		}

		// ============================================================================
		// 状态 → 动画映射（8 种状态）
		// ============================================================================
		const STATE_ANIM = {
			THINKING: '轻快记录',
			WORKING: '写代码',
			SEARCHING: '深度思考碎碎念',
			WAITING: '东张西望',
			SUCCESS: '点击回应 - 开心跃动',
			ERROR: '被吓一跳（炸毛）',
			STOPPED: '原地小憩沉眠',
		};

		// 持久状态：持续播放动画直到状态改变
		const PERSISTENT_STATES = new Set(['THINKING', 'WORKING', 'SEARCHING', 'WAITING']);
		// 脉冲状态：只播放一次动画后回到空闲
		const PULSE_STATES = new Set(['SUCCESS', 'ERROR']);

		// ============================================================================
		// 动画目录（animation catalog）—— 所有动画名和参数的"事实来源"
		// ============================================================================
		const CANVAS_H = 360;
		const FEET_Y = 330;
		const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };

		// 主体待机动画
		const IDLE = '待机呼吸休闲';
		// 转向动画（东张西望本身内容就是"从偏左看到偏右"，播完翻转 facing）
		const TURN = '东张西望';
		// 随机动作池
		const ACTS = [
			'悠闲哼歌', '超大伸懒腰', '原地专心玩魔方', '原地敲击桌面互动',
			'原地重力下蹲压缩', '哈欠连天', '原地小憩沉眠', '原地蹲下玩玩具汽车',
			'鲸鱼吐泡泡特效', '女仆屈膝礼仪', '被吓一跳（炸毛）',
			'原地跳跃抓碎头顶物品', '小幅度原地 360 度旋转展示', '偷吃零食被抓住',
			'玩游戏气急败坏', '用鲸鱼尾巴拍打地面', '打瞌睡被惊醒',
			'玩水枪', '小提琴演奏', '蓝鲸现世', '吃白饭', '照镜子',
			'优雅女仆舞', '轻快摇摆舞', '可爱宅舞', '整体换装试色',
			'大口吃零食', '吹气球', '动物环绕', '深度思考碎碎念',
			'轻快记录', '写代码', '吃Token', '吃早餐', '吃午餐', '吃晚餐',
			'放风筝', '摇扇纳凉', '吃冰淇淋融化', '被落叶淹没',
			'中秋赏月吃月饼', '堆雪人',
		];
		// 点击回应动画池（3 选 1）
		const CLICKS = ['点击回应 - 开心跃动', '点击回应 - 害羞惊讶', '点击回应 - 傲娇生气（侧身展示）'];
		// 拖拽动画
		const DRAG = '被鼠标拖拽悬空反馈';
		// 移动动画池
		const MOVES = ['螃蟹走路', '原地漂浮踏步', '原地左转奔跑'];
		// 移动参数
		const MOVE_MIN_PX = 60;
		const MOVE_MAX_PX = 240;
		const MOVE_MARGIN = 20;
		const MOVE_LEAD_SEC = 2;
		const MOVE_TAIL_SEC = 2;

		const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
		const pick = (pool, exclude) => {
			const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
			return entries[Math.floor(Math.random() * entries.length)];
		};

		// ============================================================================
		// 需求录入系统常量与工具
		// ============================================================================
		const REQSYS_API = '/pet/api';

		async function reqsysFetch(path, options) {
			const res = await fetch(REQSYS_API + path, {
				headers: { 'Content-Type': 'application/json' },
				...options,
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || res.statusText);
			}
			return res.json();
		}

		// ---- 居中编辑弹框 ----
		function showEditDialog(title, initialValue, isMultiline) {
			return new Promise(function(resolve) {
				var overlay = document.createElement('div');
				overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
				overlay.addEventListener('click', function(e) { if (e.target === e.currentTarget) { document.body.removeChild(overlay); resolve(null); } });

				var wrap = document.createElement('div');
				wrap.className = 'reqsys-card-wrap';
				wrap.style.cssText = 'width:500px;max-width:92vw';

				var card = document.createElement('div');
				card.className = 'reqsys-card';
				card.style.cssText = 'padding:24px';

				var titleEl = document.createElement('h3');
				titleEl.style.cssText = 'margin:0 0 16px 0;font-size:18px;font-weight:600';
				titleEl.textContent = title;

				var input;
				if (isMultiline) {
					input = document.createElement('textarea');
					input.style.cssText = 'width:100%;min-height:120px;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;line-height:1.5;resize:vertical;box-sizing:border-box;font-family:inherit';
					input.style.height = Math.max(120, Math.min(400, (initialValue || '').split('\n').length * 24 + 30)) + 'px';
				} else {
					input = document.createElement('input');
					input.type = 'text';
					input.style.cssText = 'width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit';
				}
				input.value = initialValue || '';
				input.autofocus = true;

				var btnRow = document.createElement('div');
				btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px';

				var cancelBtn = document.createElement('button');
				cancelBtn.className = 'reqsys-maid-btn';
				cancelBtn.textContent = '取消';
				cancelBtn.addEventListener('click', function() { document.body.removeChild(overlay); resolve(null); });

				var okBtn = document.createElement('button');
				okBtn.className = 'reqsys-maid-btn primary';
				okBtn.textContent = '确认';
				okBtn.addEventListener('click', function() { document.body.removeChild(overlay); resolve(input.value); });

				btnRow.appendChild(cancelBtn);
				btnRow.appendChild(okBtn);

				card.appendChild(titleEl);
				card.appendChild(input);
				card.appendChild(btnRow);
				wrap.appendChild(card);
				overlay.appendChild(wrap);
				document.body.appendChild(overlay);

				setTimeout(function() { input.focus(); input.select(); }, 50);
			});
		}

		function fmtTime(iso) {
			if (!iso) return '';
			const d = new Date(iso);
			return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
		}

		// ============================================================================
		// Pet 组件 —— 宠物本体
		// ============================================================================
		/**
		 * 核心组件。职责：
		 * 1. 渲染"双缓冲"的一对 <video>（A/B 交替显示），切换动画时交叉淡入
		 * 2. 状态机：空闲时随机链 vs 状态驱动
		 * 3. 朝向（facing）渲染
		 * 4. 轮询 /pet/state 获取 DSH Agent 状态
		 */
		function Pet({ config }) {
			console.log('[dsh-pet] Pet mount, fetch is:', typeof fetch, fetch === window.fetch ? 'native' : 'custom');
			const size = (config && config.size) || 462;
			const corner = (config && config.position) || 'bottom-right';
			const halfW = size / 2;
			const halfH = size * 9 / 16 / 2;

			// ---- React 状态 ----
			const [anim, setAnim] = useState(IDLE);
			const [once, setOnce] = useState(true);
			const [facing, setFacing] = useState('left');
			const [dragging, setDragging] = useState(false);
			const [customPos, setCustomPos] = useState(null);
			const [seq, setSeq] = useState(0);
			const [bubble, setBubble] = useState(null);          // 余额气泡
			const [stateMsg, setStateMsg] = useState(null);       // 状态气泡：{text, state} 或 null
			const [companionState, setCompanionState] = useState('IDLE'); // 当前 Agent 状态

			// ---- DOM 引用 ----
			const rootRef = useRef(null);
			const stageRef = useRef(null);
			const videoARef = useRef(null);
			const videoBRef = useRef(null);
			// ---- 双缓冲/竞态相关 ref ----
			const frontRef = useRef(0);
			const pendingRef = useRef(null);
			const genRef = useRef(0);
			// ---- 交互相关 ref ----
			const dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0 });
			const justDraggedRef = useRef(false);
			const lastClickRef = useRef(0);
			const clickTimerRef = useRef(null);
			const bubbleTimerRef = useRef(null);
			const animRef = useRef(IDLE);
			animRef.current = anim;

			// ---- 状态驱动相关 ref ----
			const companionStateRef = useRef('IDLE');
			companionStateRef.current = companionState;
			const stateModeRef = useRef(false);
			const stateAnimPlayedRef = useRef(false);

			// ---- 需求录入系统状态 ----
			const [reqView, setReqView] = useState(null);
			const [reqInput, setReqInput] = useState('');
			const [reqResult, setReqResult] = useState(null);
			const [reqList, setReqList] = useState([]);
			const [reqLoading, setReqLoading] = useState(false);
			const [reqFilterTags, setReqFilterTags] = useState([]);
			const [reqFilterProgs, setReqFilterProgs] = useState([]);
			const [reqFilterSearch, setReqFilterSearch] = useState('');
			const [reqTab, setReqTab] = useState('wish');
			const [reqTaskInput, setReqTaskInput] = useState('');
			const [reqTaskDeadline, setReqTaskDeadline] = useState('');
			const [reqTaskList, setReqTaskList] = useState([]);
			const [showTasks, setShowTasks] = useState(false);
			const [showRequirements, setShowRequirements] = useState(false);

			// ============================================================================
			// 状态轮询 —— 每隔 1.5s 拉取 /pet/state
			// ============================================================================
			useEffect(() => {
				let active = true;
				let timer;

				const poll = async () => {
					console.log('[dsh-pet] POLL START', Date.now());
					try {
						const url = '/pet/pet-status?_=' + Date.now();
						console.log('[dsh-pet] polling...', url);
						const res = await fetch(url, { cache: 'no-store' });
						console.log('[dsh-pet] response:', res.status, res.url);
						if (!active) { console.log('[dsh-pet] poll exit: inactive'); return; }
						if (res.status === 304) { console.log('[dsh-pet] poll exit: 304'); if (active) { timer = setTimeout(poll, 200); console.log('[dsh-pet] POLL NEXT scheduled', Date.now()); } return; } // 未变更
						const data = await res.json();
						console.log('[dsh-pet] data:', JSON.stringify(data));
						if (!active) { console.log('[dsh-pet] poll exit: inactive2'); return; }

						const newState = data.state || 'IDLE';
						const newMsg = data.message || '';
						const newDetail = data.detail || '';

						console.log('[dsh-pet] newState:', newState, 'newMsg:', newMsg, 'newDetail:', newDetail);
						setCompanionState(newState);

						// 状态气泡
						if (newState === 'IDLE' || newState === 'STOPPED') {
							setStateMsg(null);
						} else {
							setStateMsg({ text: newMsg, state: newState.toLowerCase() });
						}
					} catch (e) {
						console.warn('[dsh-pet] poll error:', e);
					}
					if (active) { timer = setTimeout(poll, 200); console.log('[dsh-pet] POLL NEXT scheduled', Date.now()); }
				};

				timer = setTimeout(poll, 100); // 首次延迟 100ms
				return () => {
					active = false;
					if (timer) clearTimeout(timer);
				};
			}, []);

			// ============================================================================
			// 状态 → 动画驱动
			// ============================================================================
			// 当 companionState 变化时，决定是否进入/退出"状态驱动"模式
			useEffect(() => {
				const prevState = companionStateRef.current;
				const newState = companionState;
				console.log('[dsh-pet] state change:', prevState, '->', newState);

				if (newState === 'IDLE') {
					// 回到空闲 → 退出状态驱动模式，当前动画播完后走随机链
					stateModeRef.current = false;
					stateAnimPlayedRef.current = false;
					return;
				}

				// 非空闲状态：进入状态驱动模式，立即切换动画
				stateModeRef.current = true;
				stateAnimPlayedRef.current = false;

				const stateAnim = STATE_ANIM[newState];
				if (stateAnim) {
					const once = PULSE_STATES.has(newState);
					setAnim(stateAnim);
					setOnce(once);
					setSeq((s) => s + 1);
				}
			}, [companionState]);

			// ============================================================================
			// 双缓冲切换（switchTo）—— 核心播放逻辑
			// ============================================================================
			const switchTo = (next, nextOnce) => {
				const pending = pendingRef.current;
				if (pending && pending.anim === next && pending.once === nextOnce) return;
				const gen = ++genRef.current;
				pendingRef.current = { anim: next, once: nextOnce, gen };

				const target = frontRef.current === 0 ? videoBRef : videoARef;
				const el = target.current;
				if (!el) return;
				el.src = '/pet/thumb/' + encodeURIComponent(next) + '.webm';
				el.loop = !nextOnce;
				el.muted = true;
				el.autoplay = true;
				el.playsInline = true;
				el.onended = nextOnce ? handleEnded : undefined;
				el.load();

				const onReady = () => {
					el.removeEventListener('loadeddata', onReady);
					if (pendingRef.current?.gen !== gen) return;
					const old = frontRef.current === 0 ? videoARef : videoBRef;
					el.classList.add('is-front');
					if (old.current && old.current !== el) old.current.classList.remove('is-front');
					frontRef.current = frontRef.current === 0 ? 1 : 0;
					pendingRef.current = null;
					el.style.transform = facingRef.current === 'right' ? 'scaleX(-1)' : '';
					el.play().catch(() => {});
					if (pendingMoveRef.current) startMoveDrive(el);
				};
				el.addEventListener('loadeddata', onReady);
				if (el.readyState >= 2) onReady();
			};

			// ---- 状态驱动播放 ----
			useEffect(() => {
				switchTo(anim, once);
			}, [anim, once, seq]);

			// ---- 组件卸载时清理 ----
			useEffect(() => () => {
				stopMove();
				if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
				if (bubbleTimerRef.current) { clearTimeout(bubbleTimerRef.current); bubbleTimerRef.current = null; }
			}, []);

			// ---- 窗口 resize ----
			useEffect(() => {
				const onResize = () => {
					setCustomPos((prev) => (prev ? { ...prev } : prev));
				};
				window.addEventListener('resize', onResize);
				return () => window.removeEventListener('resize', onResize);
			}, []);

			// ============================================================================
			// 动画链：状态驱动 vs 随机链
			// ============================================================================
			/**
			 * 获取当前状态对应的动画名（如果适用）
			 */
			const getStateAnim = () => {
				const st = companionStateRef.current;
				if (st === 'IDLE' || st === 'SUCCESS' || st === 'ERROR') {
					// SUCCESS 和 ERROR 是脉冲，只播一次
					if (stateAnimPlayedRef.current) return undefined;
				}
				return STATE_ANIM[st];
			};

			/**
			 * 随机链：按概率选下一个动画
			 */
			const pickNext = () => {
				const roll = Math.random();
				if (roll < 0.3) {
					setAnim(IDLE);
				} else if (roll < 0.4) {
					setAnim(TURN);
				} else if (roll < 0.8) {
					setAnim(pick(ACTS, animRef.current));
				} else {
					if (!tryMove()) {
						setAnim(pick(ACTS, animRef.current));
					}
				}
				setOnce(true);
				setSeq((s) => s + 1);
			};

			/**
			 * 一次性动画播完的回调：决定下一个动画。
			 * 优先处理状态驱动，然后处理用户交互打断，最后走随机链。
			 */
			const handleEnded = () => {
				console.log('[dsh-pet] handleEnded, stateMode:', stateModeRef.current, 'companionState:', companionStateRef.current);
				if (dragRef.current.active) return; // 拖拽中：不打断

				// ---- 状态驱动模式 ----
				if (stateModeRef.current) {
					const st = companionStateRef.current;

					if (st === 'IDLE') {
						// 回到空闲模式
						stateModeRef.current = false;
						pickNext();
						return;
					}

					const stateAnim = STATE_ANIM[st];
					if (stateAnim) {
						// 标记当前状态动画已播放
						stateAnimPlayedRef.current = true;

						// 脉冲状态：SUCCESS/ERROR 只播一次，然后回空闲
						if (PULSE_STATES.has(st)) {
							stateModeRef.current = false;
							setAnim(IDLE);
							setOnce(true);
							setSeq((s) => s + 1);
							return;
						}

						// 持久状态：持续播放
						setAnim(stateAnim);
						setOnce(true);
						setSeq((s) => s + 1);
						return;
					}
				}

				// ---- 转向动画播完 → 翻转朝向 ----
				if (animRef.current === TURN) {
					setFacing((f) => (f === 'left' ? 'right' : 'left'));
				}

				// ---- 点击回应/拖拽动画播完 → 先回待机缓冲 ----
				if (animRef.current === DRAG || CLICKS.includes(animRef.current)) {
					setAnim(IDLE);
					setOnce(true);
					setSeq((s) => s + 1);
					return;
				}

				// ---- 自主链动画播完 → 按概率选下一个 ----
				pickNext();
			};

			// ============================================================================
			// 移动系统
			// ============================================================================
			const moveRef = useRef(null);
			const moveTokenRef = useRef(0);
			const pendingMoveRef = useRef(null);
			const customPosRef = useRef(null);
			customPosRef.current = customPos;

			const currentCenterX = () => {
				const cp = customPosRef.current;
				if (cp) return cp.rx * window.innerWidth;
				const rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
				return window.innerWidth - 24 - halfW;
			};
			const currentCenterY = () => {
				const cp = customPosRef.current;
				if (cp) return cp.ry * window.innerHeight;
				const rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
				return window.innerHeight - 20 - halfH;
			};

			const startMoveDrive = (el) => {
				const pm = pendingMoveRef.current;
				if (!pm || moveRef.current !== null) return;
				pendingMoveRef.current = null;
				const { startRatio, startYRatio, targetRatio, dir, totalRatio } = pm;
				const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
				const travelWindow = Math.max(0.1, duration - MOVE_LEAD_SEC - MOVE_TAIL_SEC);
				const token = ++moveTokenRef.current;
				const step = () => {
					if (moveTokenRef.current !== token) return;
					const t = el.currentTime || 0;
					const rootEl = rootRef.current;
					if (rootEl) {
						const W = window.innerWidth;
						const H = window.innerHeight;
						let ratioX;
						if (t <= MOVE_LEAD_SEC) {
							ratioX = startRatio;
						} else if (t >= duration - MOVE_TAIL_SEC) {
							ratioX = targetRatio;
						} else {
							const progress = (t - MOVE_LEAD_SEC) / travelWindow;
							ratioX = startRatio + dir * totalRatio * progress;
						}
						const px = ratioX * W;
						const py = startYRatio * H;
						rootEl.style.left = (px - halfW) + 'px';
						rootEl.style.top = (py - halfH) + 'px';
						rootEl.style.right = 'auto';
						rootEl.style.bottom = 'auto';
					}
					if (t < duration - MOVE_TAIL_SEC) {
						moveRef.current = requestAnimationFrame(step);
					} else {
						moveRef.current = null;
						setCustomPos({ rx: targetRatio, ry: startYRatio });
					}
				};
				moveRef.current = requestAnimationFrame(step);
			};

			const tryMove = () => {
				if (moveRef.current !== null || pendingMoveRef.current) return true;
				const dir = (facingRef.current === 'right') !== (animRef.current === TURN) ? 1 : -1;
				const W = window.innerWidth;
				const cx = currentCenterX();
				const distance = randomBetween(MOVE_MIN_PX, MOVE_MAX_PX);
				const target = cx + dir * distance;
				const leftBound = MOVE_MARGIN + halfW;
				const rightBound = W - MOVE_MARGIN - halfW;
				if (target < leftBound || target > rightBound) return false;
				pendingMoveRef.current = {
					startRatio: cx / W,
					startYRatio: currentCenterY() / window.innerHeight,
					targetRatio: target / W,
					dir,
					totalRatio: Math.abs(target - cx) / W,
				};
				setOnce(true);
				setAnim(pick(MOVES));
				return true;
			};
			const stopMove = () => {
				pendingMoveRef.current = null;
				moveTokenRef.current++;
				if (moveRef.current !== null) {
					cancelAnimationFrame(moveRef.current);
					moveRef.current = null;
				}
			};

			const facingRef = useRef(facing);
			facingRef.current = facing;

			// ============================================================================
			// 点击 vs 拖拽
			// ============================================================================
			const DRAG_THRESHOLD = 5;

			const handlePointerDown = (e) => {
				e.currentTarget.classList.add('dragging');
				stopMove();
				e.currentTarget.setPointerCapture(e.pointerId);
				const rootEl = rootRef.current;
				let offX = 0, offY = 0;
				if (rootEl) {
					const rr = rootEl.getBoundingClientRect();
					offX = e.clientX - (rr.left + rr.width / 2);
					offY = e.clientY - (rr.top + rr.height / 2);
				}
				dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
			};
			const handlePointerMove = (e) => {
				const d = dragRef.current;
				if (!d.active) return;
				const dx = e.clientX - d.sx;
				const dy = e.clientY - d.sy;
				if (!d.dragging) {
					if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
					d.dragging = true;
					setDragging(true);
					setOnce(true);
					setAnim(DRAG);
				}
				const rootEl = rootRef.current;
				if (rootEl) {
					rootEl.style.left = (e.clientX - d.offX - halfW) + 'px';
					rootEl.style.top = (e.clientY - d.offY - halfH) + 'px';
					rootEl.style.right = 'auto';
					rootEl.style.bottom = 'auto';
				}
				const stageEl = stageRef.current;
				if (stageEl) stageEl.style.transform = 'none';
			};
			const handlePointerUp = (e) => {
				const d = dragRef.current;
				const wasDragging = d.dragging;
				d.active = false;
				d.dragging = false;
				e.currentTarget.classList.remove('dragging');
				if (wasDragging) {
					justDraggedRef.current = true;
					setTimeout(() => { justDraggedRef.current = false; }, 100);
					setDragging(false);
					setCustomPos({
						rx: (e.clientX - d.offX) / window.innerWidth,
						ry: (e.clientY - d.offY) / window.innerHeight,
					});
					const stageEl = stageRef.current;
					if (stageEl) stageEl.style.transform = 'translateY(' + bottomPad + 'px)';
					setAnim(IDLE);
					setOnce(false);
				}
			};

			// ============================================================================
			// 单击 / 双击
			// ============================================================================
			const DOUBLE_CLICK_MS = 280;
			const BUBBLE_SHOW_MS = 4000;

			const showBubble = (text, tone) => {
				setBubble({ text, tone: tone || 'normal' });
				if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
				bubbleTimerRef.current = setTimeout(() => setBubble(null), BUBBLE_SHOW_MS);
			};

			const handleDoubleClick = () => {
				setReqView('input');
			};

			const handleSingleClick = () => {
				if (once && animRef.current !== IDLE) return;
				stopMove();
				setOnce(true);
				setAnim(pick(CLICKS));
			};

			const handleClick = (e) => {
				const d = dragRef.current;
				if (d.active || d.dragging || justDraggedRef.current) return;
				const now = Date.now();
				if (now - lastClickRef.current < DOUBLE_CLICK_MS) {
					lastClickRef.current = 0;
					if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
					handleDoubleClick();
					return;
				}
				lastClickRef.current = now;
				if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
				clickTimerRef.current = setTimeout(() => {
					clickTimerRef.current = null;
					handleSingleClick();
				}, DOUBLE_CLICK_MS);
			};

			// ============================================================================
			// 渲染
			// ============================================================================
			const bottomPad = (size * 9 / 16 * (CANVAS_H - FEET_Y)) / CANVAS_H;
			const stageStyle = dragging
				? { transform: 'none' }
				: { transform: 'translateY(' + bottomPad + 'px)' };

			const rootStyle = customPos
				? (() => {
					const rx = customPos.rx;
					const ry = customPos.ry;
					const left = Math.min(Math.max(rx * window.innerWidth - halfW, 0), window.innerWidth - size);
					const top = Math.min(Math.max(ry * window.innerHeight - halfH, 0), window.innerHeight - size * 9 / 16);
					return { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' };
				})()
				: {};

			const commonVideoProps = {
				muted: true,
				playsInline: true,
				autoPlay: true,
				title: 'dsh-pet',
			};
			const hitProps = {
				className: 'dsh-pet-hit',
				style: {
					left: (HIT_BOX.x0 / 640 * 100) + '%',
					top: (HIT_BOX.y0 / 360 * 100) + '%',
					width: ((HIT_BOX.x1 - HIT_BOX.x0) / 640 * 100) + '%',
					height: ((HIT_BOX.y1 - HIT_BOX.y0) / 360 * 100) + '%',
				},
				onMouseEnter: (e) => { if (!dragRef.current.active) e.currentTarget.style.cursor = 'grab'; },
				onMouseLeave: (e) => { if (!dragRef.current.active) e.currentTarget.style.cursor = 'default'; },
				onClick: handleClick,
				onPointerDown: handlePointerDown,
				onPointerMove: handlePointerMove,
				onPointerUp: handlePointerUp,
				onPointerCancel: handlePointerUp,
				title: 'dsh-pet',
			};

			// 渲染树：root > [stage > video A/B + 命中层, 状态气泡, 余额气泡]
			return h('div', {
				ref: rootRef,
				className: 'dsh-pet-root',
				'data-corner': corner,
				'data-facing': facing,
				style: Object.assign({ '--dsh-pet-size': size + 'px' }, rootStyle),
				children: [
					h('div', {
						ref: stageRef,
						className: 'dsh-pet-stage',
						style: stageStyle,
						children: [
							h('video', Object.assign({}, commonVideoProps, { ref: videoARef, className: 'dsh-pet-video is-front' })),
							h('video', Object.assign({}, commonVideoProps, { ref: videoBRef, className: 'dsh-pet-video' })),
							h('div', hitProps),
						],
					}),
					// 状态气泡
					stateMsg
						? h('div', {
							className: 'dsh-pet-state-bubble state-' + stateMsg.state,
							children: stateMsg.text,
						})
						: null,
					// 余额气泡（双击触发，短暂显示）
					bubble
						? h('div', {
							className: 'dsh-pet-bubble' + (bubble.tone === 'error' ? ' is-error' : ''),
							children: bubble.text,
						})
						: null,
					// 需求录入系统弹窗
					reqView
						? h('div', {
							style: { position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)' },
							onClick: (e) => { if (e.target === e.currentTarget) setReqView(null); },
							children: reqView === 'input'
								? h('div', { className: 'reqsys-card-wrap', style: { width: '640px', maxWidth: '92vw' }, children: [
									h('div', { className: 'reqsys-card', style: { maxHeight: '85vh', overflowY: 'auto' }, children: [
									h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }, children: [
									h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
										h('span', { style: { padding: '6px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', background: reqTab === 'wish' ? '#526aa8' : '#f0f2f5', color: reqTab === 'wish' ? '#fff' : '#555' }, onClick: function() { setReqTab('wish'); }, children: '事已至此' }),
										h('span', { style: { padding: '6px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', background: reqTab === 'task' ? '#526aa8' : '#f0f2f5', color: reqTab === 'task' ? '#fff' : '#555' }, onClick: function() { setReqTab('task'); }, children: '你看，又急' }),
									]}),
									h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' }, children: [
										h('button', { className: 'reqsys-maid-btn', title: '查看行迹', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', fontSize: '12px', background: '#8e6bb0', color: '#fff', border: 'none' }, onClick: async () => { setShowRequirements(true); setReqLoading(true); try { const data = await reqsysFetch('/requirements'); setReqList(data || []); } catch(e) { alert('加载失败: ' + e.message); } setReqLoading(false); }, children: '行迹' }),
										h('button', { className: 'reqsys-maid-btn', title: '查看未竟', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', fontSize: '12px', background: '#8e6bb0', color: '#fff', border: 'none' }, onClick: async () => { setShowTasks(true); setReqLoading(true); try { const data = await reqsysFetch('/tasks'); setReqTaskList(data || []); } catch(e) { alert('加载失败: ' + e.message); } setReqLoading(false); }, children: '未竟' }),
									]}),
									]}),
									reqTab === 'wish'
									? h('div', { children: [
										h('p', { style: { fontSize: '13px', color: '#666', margin: '-8px 0 12px 0' }, children: '早点录完，早点休息' }),
										h('textarea', { value: reqInput, onChange: (e) => setReqInput(e.target.value), placeholder: '例如：\n1. OA审批流程优化\n2. 销售报表按月份筛选\n3. 预算系统对接财务', style: { width: '100%', minHeight: '140px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }, autoFocus: true }),
										h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }, children: [
											h('button', { className: 'reqsys-maid-btn', onClick: () => setReqView(null), children: '取消' }),
											h('button', { className: 'reqsys-maid-btn primary', onClick: async () => {
												if (!reqInput.trim()) return;
												setReqLoading(true);
												try {
													const lines = reqInput.split('\n');
													const items = []; let current = '';
													const itemPattern = /^\s*(?:\d+[.、）)]|[-*•]|\(\d+\))\s*/;
													for (const line of lines) { const l = line.trim(); if (!l) continue; if (itemPattern.test(l)) { if (current) items.push(current.trim()); current = l.replace(itemPattern, '').trim(); } else { if (current) current += ' ' + l; else current = l; } }
													if (current) items.push(current.trim());
													const processed = items.map(function(t) {
													var text = t.toLowerCase();
													var autoTags = [];
													var rules = [
														{ keywords: ['oa'], tag: 'OA' },
														{ keywords: ['qsale', '销售'], tag: '销售' },
														{ keywords: ['预算系统'], tag: 'budget' },
													];
													for (var ri = 0; ri < rules.length; ri++) {
														for (var ki = 0; ki < (rules[ri].keywords || []).length; ki++) {
															if (text.indexOf(rules[ri].keywords[ki].toLowerCase()) !== -1) {
																if (autoTags.indexOf(rules[ri].tag) === -1) autoTags.push(rules[ri].tag);
															}
														}
													}
													return { original: t, polished: t, tags: autoTags };
												});
													if (processed.length === 0) { alert('未识别到有效需求'); return; }
													setReqResult({ items: processed, multi: processed.length > 1 });
													setReqView('preview');
												} catch(e) { alert('处理失败: ' + e.message); }
												setReqLoading(false);
											}, disabled: reqLoading || !reqInput.trim(), children: reqLoading ? '处理中...' : '提交' }),
										]}),
									] })
									: h('div', { children: [
										h('p', { style: { fontSize: '13px', color: '#666', margin: '-8px 0 12px 0' }, children: '我知道你很急，但是别急' }),
										h('textarea', { value: reqTaskInput, onChange: (e) => setReqTaskInput(e.target.value), placeholder: '描述待办事项...', style: { width: '100%', minHeight: '80px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }, autoFocus: true }),
										h('div', { style: { marginTop: '12px', fontSize: '13px', color: '#555', display: 'flex', alignItems: 'center', gap: '10px' }, children: [
											h('span', { children: '截止日期：' }),
											h('input', { type: 'date', value: reqTaskDeadline, onChange: (e) => setReqTaskDeadline(e.target.value), onClick: (ev) => { try { ev.target.showPicker(); } catch(_) {} }, style: { padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', flex: 1, cursor: 'pointer' } }),
										]}),
										h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }, children: [
											h('button', { className: 'reqsys-maid-btn', onClick: () => setReqView(null), children: '取消' }),
											h('button', { className: 'reqsys-maid-btn primary', onClick: async () => {
												if (!reqTaskInput.trim()) return;
												setReqLoading(true);
												try {
													var resp = await fetch(REQSYS_API + '/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: reqTaskInput.trim(), deadline: reqTaskDeadline }) });
													var respData = await resp.json();
													if (!resp.ok) { alert('保存失败: ' + (respData.error || resp.status)); return; }
													setReqTaskInput(''); setReqTaskDeadline(''); setReqView(null);
													alert('已添加待办');
												} catch(e) { alert('保存失败: ' + e.message); }
												setReqLoading(false);
											}, disabled: reqLoading || !reqTaskInput.trim(), children: reqLoading ? '处理中...' : '添加' }),
										]}),
									] }),
								]})]})
								: reqView === 'preview' && reqResult
									? h('div', { className: 'reqsys-card-wrap', style: { width: '800px', maxWidth: '92vw' }, children: [
									h('div', { className: 'reqsys-card', style: { maxHeight: '85vh', overflowY: 'auto' }, children: [
										h('h2', { style: { margin: '0 0 16px 0', fontSize: '20px', fontWeight: 600 }, children: '📋 ' + (reqResult.multi ? '确认需求（共' + reqResult.items.length + '条）' : '确认需求') }),
										reqResult.items.map(function(item, idx) {
											return h('div', { key: idx, className: 'reqsys-preview-item', children: [
												h('div', { className: 'item-index', children: '#' + (idx + 1) }),
												h('div', { style: { fontSize: '12px', color: '#888', marginBottom: '4px', marginTop: '8px' }, children: '需求描述' }),
												h('textarea', { value: item.polished || item.original, onChange: function(e) { var newItems = reqResult.items.map(function(it, i) { if (i !== idx) return it; return Object.assign({}, it, { polished: e.target.value }); }); setReqResult(Object.assign({}, reqResult, { items: newItems })); }, style: { width: '100%', minHeight: '50px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' } }),
												h('div', { style: { fontSize: '12px', color: '#888', marginBottom: '4px', marginTop: '8px' }, children: '标签' }),
												h('div', { style: { border: '1px solid #ddd', borderRadius: '6px', padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', minHeight: '32px', boxSizing: 'border-box' }, children: [].concat(
													(item.tags || []).map(function(t) {
														return h('span', { key: t, style: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, background: '#e8f0fe', color: '#1a5cc8', cursor: 'default' }, children: [
															t,
															h('span', { style: { cursor: 'pointer', fontSize: '13px', lineHeight: '1', color: '#1a5cc8', opacity: 0.6 }, onClick: function() { var newTags = (item.tags || []).filter(function(tt) { return tt !== t; }); var newItems = reqResult.items.map(function(it, i) { if (i !== idx) return it; return Object.assign({}, it, { tags: newTags }); }); setReqResult(Object.assign({}, reqResult, { items: newItems })); }, children: '×' }),
														]});
													}),
													[h('input', { key: '_input', type: 'text', defaultValue: '', placeholder: '输入标签，回车添加', style: { border: 'none', outline: 'none', fontSize: '12px', flex: 1, minWidth: '80px', padding: '2px 4px' }, onKeyDown: function(e) { if (e.key === 'Enter') { e.preventDefault(); var val = e.target.value.trim(); if (val) { var newTags = (item.tags || []).concat([val]); var newItems = reqResult.items.map(function(it, i) { if (i !== idx) return it; return Object.assign({}, it, { tags: newTags }); }); setReqResult(Object.assign({}, reqResult, { items: newItems })); } e.target.value = ''; } } })]
												) }),
											]});
										}),
										h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }, children: [
											h('button', { className: 'reqsys-maid-btn', onClick: () => setReqView('input'), children: '返回修改' }),
											h('button', { className: 'reqsys-maid-btn primary', onClick: async () => {
												setReqLoading(true);
												try {
													var bodyStr = JSON.stringify(reqResult.items);
													var resp = await fetch(REQSYS_API + '/requirements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyStr });
													var respData = await resp.json();
													if (!resp.ok) { alert('保存失败: ' + (respData.error || resp.status)); return; }
													setReqView(null); setReqInput(''); setReqResult(null);
												} catch(e) { alert('保存失败: ' + e.message); }
												setReqLoading(false);
											}, disabled: reqLoading, children: reqLoading ? '保存中...' : '确认保存' }),
										]}),
									]})]})
									: null
						})
						: null,
					// 行迹列表
					showRequirements
						? h('div', { style: { position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)' }, onClick: function(e) { if (e.target === e.currentTarget) setShowRequirements(false); }, children: reqLoading
							? h('div', { className: 'reqsys-card-wrap', style: { width: '1100px', maxWidth: '95vw' }, children: [
								h('div', { className: 'reqsys-card', style: { height: '70vh', overflowY: 'auto' }, children: [
								h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [
									h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '📋 行迹' }),
									h('button', { className: 'reqsys-maid-btn', onClick: () => setShowRequirements(false), children: '关闭' }),
								]}),
								h('div', { style: { textAlign: 'center', padding: '40px 20px', color: '#999', fontSize: '14px' }, children: [
									h('div', { style: { fontSize: '32px', marginBottom: '12px' }, children: '⏳' }),
									h('div', { children: '加载中...' }),
								]}),
							]})]})
							: h(ReqsysListView, { reqList: reqList, setReqList: setReqList, reqFilterTags: reqFilterTags, setReqFilterTags: setReqFilterTags, reqFilterProgs: reqFilterProgs, setReqFilterProgs: setReqFilterProgs, reqFilterSearch: reqFilterSearch, setReqFilterSearch: setReqFilterSearch, onClose: function() { setShowRequirements(false); } })
						})
						: null,
					// 未竟任务列表
					showTasks ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)' }, onClick: function(e) { if (e.target === e.currentTarget) setShowTasks(false); }, children: reqTaskList.length === 0
								? h('div', { className: 'reqsys-card-wrap', style: { width: '500px', maxWidth: '92vw' }, children: h('div', { className: 'reqsys-card', style: { textAlign: 'center', padding: '40px 20px' }, children: [
									h('div', { style: { fontSize: '32px', marginBottom: '12px' }, children: '📭' }),
									h('div', { style: { fontSize: '14px', color: '#999', marginBottom: '16px' }, children: '暂无未竟之事' }),
									h('button', { className: 'reqsys-maid-btn', onClick: function() { setShowTasks(false); }, children: '关闭' }),
								]}) })
								: h(TaskListView, { taskList: reqTaskList, setTaskList: setReqTaskList, onClose: function() { setShowTasks(false); } })
						}) : null,
				],
			});
		}

		// ============================================================================
		// 需求录入系统组件
		// ============================================================================
		var PAGE_SIZE = 15;

		function ReqsysListView(props) {
			var reqList = props.reqList;
			var setReqList = props.setReqList;
			var reqFilterTags = props.reqFilterTags;
			var setReqFilterTags = props.setReqFilterTags;
			var reqFilterProgs = props.reqFilterProgs;
			var setReqFilterProgs = props.setReqFilterProgs;
			var reqFilterSearch = props.reqFilterSearch;
			var setReqFilterSearch = props.setReqFilterSearch;
			var onClose = props.onClose;
			var currentPage = 0;
			var setPage = useState(0);
			currentPage = setPage[0];
			var setPageFn = setPage[1];
			var showRules = useState(false);
			var showRulesVal = showRules[0];
			var setShowRules = showRules[1];
			var rulesData = useState([]);
			var rules = rulesData[0];
			var setRules = rulesData[1];
			var reqFilterVersion = useState([]);
			var reqFilterVersionVal = reqFilterVersion[0];
			var setReqFilterVersion = reqFilterVersion[1];
			var reqShowArchived = useState(false);
			var reqShowArchivedVal = reqShowArchived[0];
			var setReqShowArchived = reqShowArchived[1];
			var versionOpen = useState(false);
			var versionOpenVal = versionOpen[0];
			var setVersionOpen = versionOpen[1];
			var tagOpen = useState(false);
			var tagOpenVal = tagOpen[0];
			var setTagOpen = tagOpen[1];
			var progOpen = useState(false);
			var progOpenVal = progOpen[0];
			var setProgOpen = progOpen[1];
			var batchCmdState = useState('');
			var batchCmd = batchCmdState[0];
			var setBatchCmd = batchCmdState[1];
			var editingTagRow = useState(null);
			var editingTagRowId = editingTagRow[0];
			var setEditingTagRow = editingTagRow[1];
			var editingTagInput = useState('');
			var editingTagInputVal = editingTagInput[0];
			var setEditingTagInput = editingTagInput[1];
			var batchConfirmState = useState(null);
			var batchConfirm = batchConfirmState[0];
			var setBatchConfirm = batchConfirmState[1];
			var reqSelectedIdsState = useState([]);
			var reqSelectedIds = reqSelectedIdsState[0];
			var setReqSelectedIds = reqSelectedIdsState[1];

			// 解析自然语言批量指令
			function parseBatchCmd(cmd) {
				var result = { action: 'CHANGE_STATUS', version: '', tag: '', filterStatus: '', targetStatus: '', desc: cmd };
				// 检测动作类型
				if (cmd.indexOf('放在') !== -1) {
					result.action = 'SET_VERSION';
				} else if (cmd.trim().indexOf('归档') === 0) {
					result.action = 'ARCHIVE';
				}
				// 提取版本号（通用）
				var vMatch = cmd.match(/v?\d+(?:\.\d+)?/);
				if (vMatch) result.version = vMatch[0];
				// 提取标签：XX标签 / 标签为XX / XX相关需求
				var tagMatch = cmd.match(/(\S{2,6})标签/);
				if (!tagMatch) tagMatch = cmd.match(/(?:标签[为:：]?\s*)(\S+)/);
				if (!tagMatch) tagMatch = cmd.match(/(\S{2,6})(?:相关需求)/);
				if (tagMatch) {
					var t = tagMatch[1].trim();
					var nonTags = ['版本', '已发布', '方案设计', '废弃', '未处理', '批量', '批量的', '放在', '归档', '进展'];
					if (nonTags.indexOf(t) === -1) result.tag = t;
				}
				if (result.action === 'SET_VERSION') {
					// 从"放在XX版本"提取目标版本
					var fv = cmd.match(/放在\s*(v?\d+(?:\.\d+)?)\s*(?:版本)?/);
					if (fv) result.targetVersion = fv[1];
					result.desc = '设版本: ' + (result.tag ? '标签[' + result.tag + '] ' : '') + '→ 版本' + (result.targetVersion || result.version);
				} else if (result.action === 'ARCHIVE') {
					result.filterStatus = '';
					result.desc = '归档: 版本' + result.version + ' 的需求';
				} else {
					// CHANGE_STATUS
					// 提取目标状态：进展改为XX / 改为XX / 直接扫描
					var tsMatch = cmd.match(/进展改为\s*(\S+)/);
					if (!tsMatch) tsMatch = cmd.match(/改为\s*(\S+)/);
					var statuses = ['已发布', '方案设计', '废弃', '未处理'];
					if (tsMatch) {
						var st = tsMatch[1];
						// 匹配完整状态名
						for (var si = 0; si < statuses.length; si++) {
							if (st.indexOf(statuses[si]) !== -1 || statuses[si].indexOf(st) !== -1) {
								result.targetStatus = statuses[si]; break;
							}
						}
						if (!result.targetStatus) result.targetStatus = st;
					} else {
						for (var si = 0; si < statuses.length; si++) {
							if (cmd.indexOf(statuses[si]) !== -1) { result.targetStatus = statuses[si]; break; }
						}
					}
					// 提取筛选状态：XX状态 或 "改为"前的状态
					var fsMatch = cmd.match(/(\S{2,4})状态/);
					if (fsMatch) {
						var fs = fsMatch[1];
						for (var si = 0; si < statuses.length; si++) {
							if (fs.indexOf(statuses[si]) !== -1 || statuses[si].indexOf(fs) !== -1) {
								result.filterStatus = statuses[si]; break;
							}
						}
					}
					if (!result.filterStatus) {
						// 找"改为"或"的需求"前面的状态
						var splitIdx = -1;
						var gaiIdx = cmd.indexOf('改为');
						if (gaiIdx !== -1) splitIdx = gaiIdx;
						var xuqIdx = cmd.indexOf('的需求');
						if (xuqIdx !== -1 && (splitIdx === -1 || xuqIdx < splitIdx)) splitIdx = xuqIdx;
						if (splitIdx !== -1) {
							var before = cmd.substring(0, splitIdx);
							for (var si = 0; si < statuses.length; si++) {
								if (before.indexOf(statuses[si]) !== -1) { result.filterStatus = statuses[si]; break; }
							}
						}
					}
					// 推断筛选条件（兼容旧格式）
					if (!result.filterStatus) {
						if (result.targetStatus === '方案设计') result.filterStatus = '未处理';
						else if (result.targetStatus) result.filterStatus = '方案设计';
					}
					result.desc = '改进展: ' + (result.version ? '版本' + result.version + ' ' : '') + (result.tag ? '标签[' + result.tag + '] ' : '') + (result.filterStatus ? '当前"' + result.filterStatus + '"' : '') + ' → "' + result.targetStatus + '"';
				}
				return result;
			}

			function doBatchCmd() {
				var cmd = batchCmd.trim();
				if (!cmd) return;
				var parsed = parseBatchCmd(cmd);
				// 筛选匹配项（按动作类型）
				var matches = [];
				if (parsed.action === 'SET_VERSION') {
					if (!parsed.tag) { alert('设置版本需要指定标签，如 "OA标签的需求，放在v5.3版本"'); return; }
					if (!parsed.targetVersion && !parsed.version) { alert('未识别到目标版本号'); return; }
					var targetV = parsed.targetVersion || parsed.version;
					matches = reqList.filter(function(r) {
						if (r.archived) return false;
						var hasTag = (r.tags || []).indexOf(parsed.tag) !== -1;
						if (!hasTag) return false;
						return true;
					});
					parsed.targetVersion = targetV;
					if (matches.length === 0) { alert('未找到标签为"' + parsed.tag + '"的需求'); return; }
				} else if (parsed.action === 'ARCHIVE') {
					if (!parsed.version) { alert('归档需要指定版本号，如 "归档v5.3版本的需求"'); return; }
					matches = reqList.filter(function(r) {
						if (r.archived) return false;
						if (r.version !== parsed.version) return false;
						return true;
					});
					if (matches.length === 0) { alert('未找到版本' + parsed.version + '的未归档需求'); return; }
				} else {
					// CHANGE_STATUS
					if (!parsed.targetStatus) { alert('未识别到目标状态，如 "进展改为已发布"'); return; }
					matches = reqList.filter(function(r) {
						if (r.archived) return false;
						if (parsed.version && r.version !== parsed.version) return false;
						if (parsed.tag) {
							var hasTag = (r.tags || []).indexOf(parsed.tag) !== -1;
							if (!hasTag) return false;
						}
						if (parsed.filterStatus && r.progress !== parsed.filterStatus) return false;
						return true;
					});
					if (matches.length === 0) {
						alert('未找到匹配的需求' + (parsed.version ? '\n版本: ' + parsed.version : '') + (parsed.tag ? '  标签: ' + parsed.tag : '') + (parsed.filterStatus ? '\n当前进展: ' + parsed.filterStatus : ''));
						return;
					}
				}
				// 打开确认弹框
				setBatchConfirm({ parsed: parsed, matches: matches, selected: matches.map(function(m) { return m.id; }) });
			}

			function doBatchExecute(selectedIds) {
				var matches = batchConfirm.matches.filter(function(m) { return selectedIds.indexOf(m.id) !== -1; });
				if (matches.length === 0) { setBatchConfirm(null); return; }
				var bp = batchConfirm.parsed;
				var done = 0;
				matches.forEach(function(r) {
					var body = {};
					if (bp.action === 'SET_VERSION') {
						body = { version: bp.targetVersion || bp.version };
					} else if (bp.action === 'ARCHIVE') {
						body = { archived: true };
					} else {
						body = { polished: r.polished || r.original, tags: r.tags || [], progress: bp.targetStatus, version: r.version, reason: r.reason || '' };
					}
					reqsysFetch('/requirements/' + r.id, { method: 'PUT', body: JSON.stringify(body) }).then(function() {
						done++;
						if (done === matches.length) {
							reqsysFetch('/requirements').then(function(data) { setReqList(data || []); setBatchCmd(''); setBatchConfirm(null); }).catch(function(e) { alert('刷新失败: ' + e.message); });
						}
					}).catch(function(e) { alert('更新失败: ' + e.message); });
				});
			}

			var currentTabItems = reqList.filter(function(r) { return reqShowArchivedVal ? r.archived : !r.archived; });
			var allTags = [];
			var allProgs = ['未处理', '方案设计', '已发布', '废弃'];
			currentTabItems.forEach(function(r) {
				(r.tags || []).forEach(function(t) {
					if (allTags.indexOf(t) === -1) allTags.push(t);
				});
			});
			var allVersions = [];
			var hasEmptyVersion = false;
			currentTabItems.forEach(function(r) {
				var v = (r.version || '').trim();
				if (v) {
					if (allVersions.indexOf(v) === -1) allVersions.push(v);
				} else {
					hasEmptyVersion = true;
				}
			});
			allVersions.sort();
			if (hasEmptyVersion) allVersions.unshift('(空)');

			var filtered = reqList.filter(function(r) {
				if (reqShowArchivedVal ? !r.archived : r.archived) return false;
				if (reqFilterTags.length > 0) {
					var hasTag = false;
					reqFilterTags.forEach(function(t) { if ((r.tags || []).indexOf(t) !== -1) hasTag = true; });
					if (!hasTag) return false;
				}
				if (reqFilterProgs.length > 0) {
					if (reqFilterProgs.indexOf(r.progress || '未处理') === -1) return false;
				}
				if (reqFilterSearch.trim()) {
					var s = reqFilterSearch.trim().toLowerCase();
					var desc = (r.polished || r.original || '').toLowerCase();
					if (desc.indexOf(s) === -1) return false;
				}
				if (reqFilterVersionVal.length > 0) {
					var rv = r.version || '';
					var matchesFilter = false;
					reqFilterVersionVal.forEach(function(fv) {
						if (fv === '(空)' && !rv) { matchesFilter = true; }
						else if (fv !== '(空)' && fv === rv) { matchesFilter = true; }
					});
					if (!matchesFilter) return false;
				}
				return true;
			});

			useEffect(function() {
				setPageFn(0);
			}, [reqFilterTags, reqFilterProgs, reqFilterSearch, reqFilterVersionVal]);

			var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
			var pageStart = currentPage * PAGE_SIZE;
			var pageItems = filtered.slice().reverse().slice(pageStart, pageStart + PAGE_SIZE);

			function updateReq(id, progress, version, reason) {
				return reqsysFetch('/requirements/' + id, { method: 'PUT', body: JSON.stringify({ progress: progress, version: version, reason: reason }) }).then(function() {
					setReqList(function(list) {
						return list.map(function(r) {
							if (r.id !== id) return r;
							var updated = Object.assign({}, r, { progress: progress });
							if (version !== undefined) updated.version = version;
							if (reason !== undefined) updated.reason = reason;
							return updated;
						});
					});
				}).catch(function(e) { alert('更新失败: ' + e.message); });
			}

			function updateReqPolished(id, polished) {
				return reqsysFetch('/requirements/' + id, { method: 'PUT', body: JSON.stringify({ polished: polished }) }).then(function() {
					setReqList(function(list) {
						return list.map(function(r) {
							if (r.id !== id) return r;
							return Object.assign({}, r, { polished: polished });
						});
					});
				}).catch(function(e) { alert('更新失败: ' + e.message); });
			}

			function updateReqTags(id, tags) {
				return reqsysFetch('/requirements/' + id, { method: 'PUT', body: JSON.stringify({ tags: tags }) }).then(function() {
					setReqList(function(list) {
						return list.map(function(r) {
							if (r.id !== id) return r;
							return Object.assign({}, r, { tags: tags });
						});
					});
				}).catch(function(e) { alert('标签更新失败: ' + e.message); });
			}

			// 标签规则管理弹窗
			if (showRulesVal) {
				return h('div', { style: { position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function(e) { if (e.target === e.currentTarget) setShowRules(false); }, children: h('div', { className: 'reqsys-card-wrap', style: { width: '500px', maxWidth: '92vw' }, children: [
					h('div', { className: 'reqsys-card', style: { maxHeight: '80vh', overflowY: 'auto' }, children: [
						h('h2', { style: { margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600 }, children: '⚙ 自动标签规则' }),
						h('p', { style: { fontSize: '12px', color: '#888', marginBottom: '12px' }, children: '设置关键词与标签的映射规则，提交需求时自动匹配。' }),
						rules.map(function(rule, idx) {
							return h('div', { key: idx, style: { border: '1px solid #eee', borderRadius: '8px', padding: '10px', marginBottom: '8px' }, children: [
								h('div', { style: { display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }, children: [
									h('input', { type: 'text', value: rule.tag, placeholder: '标签名', onChange: function(e) { var newRules = rules.map(function(r, i) { if (i !== idx) return r; return Object.assign({}, r, { tag: e.target.value }); }); setRules(newRules); }, style: { flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' } }),
									h('button', { style: { padding: '4px 10px', border: '1px solid #e55', borderRadius: '6px', background: '#fff', color: '#e55', fontSize: '12px', cursor: 'pointer' }, onClick: function() { var newRules = rules.filter(function(_, i) { return i !== idx; }); setRules(newRules); }, children: '删除' }),
								]}),
								h('input', { type: 'text', value: (rule.keywords || []).join(', '), placeholder: '关键词，用逗号分隔', onChange: function(e) { var newKeywords = e.target.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean); var newRules = rules.map(function(r, i) { if (i !== idx) return r; return Object.assign({}, r, { keywords: newKeywords }); }); setRules(newRules); }, style: { width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' } }),
							]});
						}),
						h('button', { style: { padding: '6px 14px', border: '1px dashed #aaa', borderRadius: '6px', background: '#fafafa', color: '#666', fontSize: '12px', cursor: 'pointer', width: '100%', marginBottom: '12px' }, onClick: function() { setRules(rules.concat([{ tag: '', keywords: [''] }])); }, children: '+ 添加规则' }),
						h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' }, children: [
							h('button', { className: 'reqsys-maid-btn', onClick: function() { setShowRules(false); }, children: '取消' }),
							h('button', { className: 'reqsys-maid-btn primary', onClick: function() { reqsysFetch('/rules', { method: 'PUT', body: JSON.stringify(rules) }).then(function() { setShowRules(false); alert('规则已保存'); }).catch(function(e) { alert('保存失败: ' + e.message); }); }, children: '保存' }),
						]}),
					]})]}) });
			}

			// 批量确认弹框
			if (batchConfirm) {
				var bp = batchConfirm.parsed;
				var bm = batchConfirm.matches;
				var bs = batchConfirm.selected;
				return h('div', { style: { position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: function(e) { if (e.target === e.currentTarget) setBatchConfirm(null); }, children: h('div', { className: 'reqsys-card-wrap', style: { width: '800px', maxWidth: '92vw' }, children: [
					h('div', { className: 'reqsys-card', style: { maxHeight: '80vh', overflowY: 'auto' }, children: [
						h('h3', { style: { margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }, children: '批量执行确认' }),
						h('div', { style: { fontSize: '13px', color: '#555', marginBottom: '12px', padding: '8px 12px', background: '#f8f6ff', borderRadius: '6px' }, children: [
							h('div', { children: '指令: ' + bp.desc }),
							
						]}),
						h('div', { style: { fontSize: '12px', color: '#888', marginBottom: '8px' }, children: '取消勾选以排除（共 ' + bm.length + ' 条匹配）' }),
						bm.map(function(m, mi) {
							var checked = bs.indexOf(m.id) !== -1;
							return h('div', { key: m.id, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: checked ? '#fff' : '#f5f5f5', borderRadius: '6px', marginBottom: '4px', border: '1px solid ' + (checked ? '#e8e0f0' : '#eee') }, children: [
								h('input', { type: 'checkbox', checked: checked, onChange: function() { var idx = bs.indexOf(m.id); if (idx === -1) { setBatchConfirm(Object.assign({}, batchConfirm, { selected: bs.concat([m.id]) })); } else { var ns = bs.slice(); ns.splice(idx, 1); setBatchConfirm(Object.assign({}, batchConfirm, { selected: ns })); } }, style: { cursor: 'pointer', margin: 0 } }),
								h('span', { style: { flex: 1, fontSize: '13px', color: checked ? '#333' : '#999', textDecoration: checked ? 'none' : 'line-through' }, children: (m.polished || m.original || '') + ' (v' + m.version + ')' }),
							]});
						}),
						h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }, children: [
							h('button', { className: 'reqsys-maid-btn', onClick: function() { setBatchConfirm(null); }, children: '取消' }),
							h('button', { className: 'reqsys-maid-btn primary', onClick: function() { doBatchExecute(bs); }, disabled: bs.length === 0, children: '执行 (' + bs.length + ' 条)' }),
						]}),
					]})]}) });
			}

			return h('div', { className: 'reqsys-card-wrap', style: { width: '1100px', maxWidth: '95vw' }, children: [
				h('div', { className: 'reqsys-card', style: { height: '70vh', overflowY: 'auto' }, children: [
				h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
						h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '📋 行迹' }),
						h('span', { style: { padding: '4px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: !reqShowArchivedVal ? '#8e6bb0' : '#f0f2f5', color: !reqShowArchivedVal ? '#fff' : '#555' }, onClick: function() { setReqShowArchived(false); setReqSelectedIds([]); }, children: '活动中' }),
						h('span', { style: { padding: '4px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: reqShowArchivedVal ? '#8e6bb0' : '#f0f2f5', color: reqShowArchivedVal ? '#fff' : '#555' }, onClick: function() { setReqShowArchived(true); setReqSelectedIds([]); }, children: '已归档' }),
					]}),
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
						h('button', { className: 'reqsys-maid-btn', style: { background: '#25a55e', color: '#fff', border: 'none' }, onClick: function() { var BOM = '\uFEFF'; var header = '记录时间,需求描述,标签,当前进展,版本,废弃原因' + (reqShowArchivedVal ? ',归档时间' : '') + '\n'; var rows = filtered.map(function(r) { var desc = (r.polished || r.original || '').replace(/"/g, '""'); var tags = (r.tags || []).join('; '); return fmtTime(r.timestamp) + ',"' + desc + '",' + tags + ',' + (r.progress || '未处理') + ',' + (r.version || '') + ',' + (r.reason || '') + (reqShowArchivedVal ? ',' + (r.archivedAt ? fmtTime(r.archivedAt) : '') : ''); }).join('\n'); var blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '行迹_' + new Date().toISOString().slice(0,10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 CSV' }),
						h('button', { className: 'reqsys-maid-btn', onClick: function() { var blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '行迹_' + new Date().toISOString().slice(0,10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 JSON' }),
						h('button', { className: 'reqsys-maid-btn', style: { background: '#8e6bb0', color: '#fff', border: 'none' }, onClick: function() { reqsysFetch('/rules').then(function(r) { setRules(r || []); setShowRules(true); }).catch(function(e) { alert('加载规则失败: ' + e.message); }); }, children: '⚙ 配置标签' }),
					]}),
				]}),
				h('div', { className: 'reqsys-filter-bar', children: [
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '标签' }),
						h('div', { style: { position: 'relative' }, children: [
							h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px', minWidth: '120px', textAlign: 'left' }, onClick: function() { setTagOpen(!tagOpenVal); }, children: '标签 ' + (reqFilterTags.length > 0 ? '(' + reqFilterTags.length + ')' : '') + (tagOpenVal ? ' ▲' : ' ▼') }),
							tagOpenVal ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 9 }, onClick: function() { setTagOpen(false); } }) : null,
							tagOpenVal ? h('div', { style: { position: 'absolute', top: '100%', left: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.15)', padding: '6px', minWidth: '160px', maxHeight: '200px', overflowY: 'auto' }, children: allTags.map(function(t) {
								var active = reqFilterTags.indexOf(t) !== -1;
								return h('div', { key: t, style: { padding: '4px 8px', cursor: 'pointer', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: active ? '#e8f0fe' : 'transparent' }, onClick: function() { var idx = reqFilterTags.indexOf(t); if (idx === -1) { setReqFilterTags(reqFilterTags.concat([t])); } else { var newTags = reqFilterTags.slice(); newTags.splice(idx, 1); setReqFilterTags(newTags); } }, children: [
									h('input', { type: 'checkbox', checked: active, style: { margin: 0, cursor: 'pointer' }, onChange: function() {} }),
									h('span', { children: t }),
								]});
							}) }) : null,
						]}),
					]}),
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '进展' }),
						h('div', { style: { position: 'relative' }, children: [
							h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px', minWidth: '120px', textAlign: 'left' }, onClick: function() { setProgOpen(!progOpenVal); }, children: '进展 ' + (reqFilterProgs.length > 0 ? '(' + reqFilterProgs.length + ')' : '') + (progOpenVal ? ' ▲' : ' ▼') }),
							progOpenVal ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 9 }, onClick: function() { setProgOpen(false); } }) : null,
							progOpenVal ? h('div', { style: { position: 'absolute', top: '100%', left: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.15)', padding: '6px', minWidth: '160px' }, children: allProgs.map(function(p) {
								var active = reqFilterProgs.indexOf(p) !== -1;
								return h('div', { key: p, style: { padding: '4px 8px', cursor: 'pointer', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: active ? '#e8f0fe' : 'transparent' }, onClick: function() { var idx = reqFilterProgs.indexOf(p); if (idx === -1) { setReqFilterProgs(reqFilterProgs.concat([p])); } else { var newProgs = reqFilterProgs.slice(); newProgs.splice(idx, 1); setReqFilterProgs(newProgs); } }, children: [
									h('input', { type: 'checkbox', checked: active, style: { margin: 0, cursor: 'pointer' }, onChange: function() {} }),
									h('span', { children: p }),
								]});
							}) }) : null,
						]}),
					]}),
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '版本' }),
						h('div', { style: { position: 'relative' }, children: [
							h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px', minWidth: '120px', textAlign: 'left' }, onClick: function() { setVersionOpen(!versionOpenVal); }, children: '版本 ' + (reqFilterVersionVal.length > 0 ? '(' + reqFilterVersionVal.length + ')' : '') + (versionOpenVal ? ' ▲' : ' ▼') }),
							versionOpenVal ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 9 }, onClick: function() { setVersionOpen(false); } }) : null,
							versionOpenVal ? h('div', { style: { position: 'absolute', top: '100%', left: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.15)', padding: '6px', minWidth: '160px', maxHeight: '200px', overflowY: 'auto' }, children: allVersions.map(function(v) {
								var active = reqFilterVersionVal.indexOf(v) !== -1;
								return h('div', { key: v, style: { padding: '4px 8px', cursor: 'pointer', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: active ? '#e8f0fe' : 'transparent' }, onClick: function() { var idx = reqFilterVersionVal.indexOf(v); if (idx === -1) { setReqFilterVersion(reqFilterVersionVal.concat([v])); } else { var nv = reqFilterVersionVal.slice(); nv.splice(idx, 1); setReqFilterVersion(nv); } }, children: [
									h('input', { type: 'checkbox', checked: active, style: { margin: 0, cursor: 'pointer' }, onChange: function() {} }),
									h('span', { children: v }),
								]});
							}) }) : null,
						]}),
					]}),
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '搜索' }),
						h('input', { type: 'text', value: reqFilterSearch, onChange: function(e) { setReqFilterSearch(e.target.value); }, placeholder: '搜索需求描述...', style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', width: '300px', boxSizing: 'border-box' } }),
					]}),
					h('span', { className: 'filter-count', children: '共 ' + filtered.length + ' 条' }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 10px', fontSize: '11px', background: reqSelectedIds.length > 0 ? '#8e6bb0' : '#ccc', color: '#fff', border: 'none', alignSelf: 'flex-end' }, onClick: function() { if (reqSelectedIds.length === 0) return; var isArchiving = !reqShowArchivedVal; var label = isArchiving ? '归档' : '重启'; if (!confirm('确认' + label + '选中的 ' + reqSelectedIds.length + ' 条需求？')) return; var done = 0; reqSelectedIds.forEach(function(id) { var body = isArchiving ? { archived: true } : { archived: false, progress: '未处理' }; reqsysFetch('/requirements/' + id, { method: 'PUT', body: JSON.stringify(body) }).then(function() { done++; if (done === reqSelectedIds.length) { reqsysFetch('/requirements').then(function(data) { setReqList(data || []); setReqSelectedIds([]); }).catch(function(e) { alert('刷新失败: ' + e.message); }); } }).catch(function(e) { alert(label + '失败: ' + e.message); }); }); }, children: (reqShowArchivedVal ? '🔄 重启选中' : '📦 归档选中') + ' (' + reqSelectedIds.length + ')' }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 10px', fontSize: '11px', color: '#888', border: '1px solid #ddd', background: '#fff', alignSelf: 'flex-end' }, onClick: function() { setReqFilterTags([]); setReqFilterProgs([]); setReqFilterSearch(''); setReqFilterVersion([]); setBatchCmd(''); setReqSelectedIds([]); }, children: '重置' }),
				]}),
				// 批量指令栏
				h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', padding: '8px 12px', background: '#f8f6ff', borderRadius: '8px', border: '1px solid #e8e0f0' }, children: [
					h('input', { type: 'text', value: batchCmd, onChange: function(e) { setBatchCmd(e.target.value); }, onKeyDown: function(e) { if (e.key === 'Enter') { e.preventDefault(); doBatchCmd(); } }, placeholder: '指令：设版本 / 归档 / 改进展，如 "OA标签的需求，放在v5.3"', style: { flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' } }),
					h('button', { className: 'reqsys-maid-btn', style: { background: '#8e6bb0', color: '#fff', border: 'none', padding: '6px 14px', fontSize: '13px' }, onClick: function() { doBatchCmd(); }, children: '批量执行' }),
				]}),
				filtered.length === 0
					? h('div', { style: { textAlign: 'center', padding: '40px 20px', color: '#999' }, children: '暂无匹配的需求记录' })
					: h('div', { style: { overflowX: 'auto' }, children: h('table', { className: 'reqsys-table', children: [
						h('thead', { children: h('tr', { children: [
							h('th', { style: { width: '30px', textAlign: 'center' }, children: '#' }),
							h('th', { style: { width: '28px', textAlign: 'center', verticalAlign: 'middle' }, children: h('input', { type: 'checkbox', checked: filtered.length > 0 && reqSelectedIds.length === filtered.length, onChange: function() { if (reqSelectedIds.length === filtered.length) { setReqSelectedIds([]); } else { setReqSelectedIds(filtered.map(function(r) { return r.id; })); } }, style: { cursor: 'pointer', margin: 0, verticalAlign: 'middle' } }) }),
							h('th', { style: { width: '100px' }, children: '记录时间' }),
							h('th', { children: '需求描述' }),
							h('th', { style: { width: '120px' }, children: '标签' }),
							h('th', { style: { width: '90px' }, children: '当前进展' }),
							h('th', { style: { width: '70px' }, children: '版本' }),
							h('th', { style: { width: '70px' }, children: '废弃原因' }),
							reqShowArchivedVal ? h('th', { style: { width: '90px' }, children: '归档时间' }) : null,
							h('th', { style: { width: '50px' }, children: '操作' }),
						]}) }),
						h('tbody', { children: pageItems.map(function(r, i) {
							var readOnly = reqShowArchivedVal;
							var roUpdateReq = readOnly ? function() {} : updateReq;
							return h('tr', { key: r.id, children: [
								h('td', { style: { padding: '8px 6px', borderBottom: '1px solid #f0f0f0', color: '#999', fontSize: '11px', textAlign: 'center' }, children: pageStart + i + 1 }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'center', verticalAlign: 'middle' }, children: h('input', { type: 'checkbox', checked: reqSelectedIds.indexOf(r.id) !== -1, onChange: function() { var idx = reqSelectedIds.indexOf(r.id); if (idx === -1) { setReqSelectedIds(reqSelectedIds.concat([r.id])); } else { var ns = reqSelectedIds.slice(); ns.splice(idx, 1); setReqSelectedIds(ns); } }, style: { cursor: 'pointer', margin: 0, verticalAlign: 'middle' } }) }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }, children: fmtTime(r.timestamp) }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', whiteSpace: 'normal', wordBreak: 'break-word', cursor: readOnly ? 'default' : 'pointer' }, onClick: readOnly ? null : function() { showEditDialog('编辑需求描述', r.polished || r.original || '', true).then(function(newDesc) { if (newDesc === null) return; updateReqPolished(r.id, newDesc.trim()); }); }, children: r.polished || r.original || '' }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', cursor: readOnly ? 'default' : 'pointer' }, onClick: readOnly ? null : function(e) { e.stopPropagation(); if (editingTagRowId === r.id) return; setEditingTagRow(r.id); setEditingTagInput(''); }, children: (function() {
									if (editingTagRowId !== r.id) {
										var tags = r.tags || [];
										return tags.length > 0
											? tags.map(function(t) {
												return h('span', { key: t, style: { display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, background: '#e8f0fe', color: '#1a5cc8', margin: '1px 2px' }, children: t });
											})
											: h('span', { style: { fontSize: '12px', color: '#ccc' }, children: '点击添加' });
									}
									var currentTags = (r.tags || []).slice();
									return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', minWidth: '160px' }, children: [].concat(
										currentTags.map(function(t, ti) {
											return h('span', { key: t, style: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, background: '#e8f0fe', color: '#1a5cc8', cursor: 'default' }, children: [
												t,
												h('span', { style: { cursor: 'pointer', fontSize: '13px', lineHeight: '1', color: '#1a5cc8', opacity: 0.6 }, onClick: function(e) { e.stopPropagation(); var newTags = currentTags.filter(function(_, i) { return i !== ti; }); updateReqTags(r.id, newTags); if (newTags.length === 0) setEditingTagRow(null); }, children: '×' }),
											]});
										}),
										[
											h('input', { key: '_input', type: 'text', value: editingTagInputVal, placeholder: '回车添加', style: { border: 'none', outline: 'none', fontSize: '12px', flex: 1, minWidth: '60px', padding: '2px 4px', background: 'transparent' }, onChange: function(e) { setEditingTagInput(e.target.value); }, onKeyDown: function(e) { if (e.key === 'Enter') { e.preventDefault(); var val = editingTagInputVal.trim(); if (val) { var newTags = currentTags.concat([val]); updateReqTags(r.id, newTags); setEditingTagInput(''); } else { setEditingTagRow(null); } } if (e.key === 'Escape') { setEditingTagRow(null); } }, onBlur: function() { setTimeout(function() { setEditingTagRow(null); }, 200); }, autoFocus: true }),
											h('span', { style: { cursor: 'pointer', fontSize: '14px', color: '#888', lineHeight: 1, padding: '0 2px' }, onClick: function(e) { e.stopPropagation(); setEditingTagRow(null); }, children: '✓' }),
										]
									)});
								})() }),
								ReqsysSelectCell(r, roUpdateReq),
								ReqsysVersionCell(r, roUpdateReq),
								ReqsysReasonCell(r, roUpdateReq),
								reqShowArchivedVal ? h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '11px', color: '#999', whiteSpace: 'nowrap' }, children: r.archivedAt ? fmtTime(r.archivedAt) : '' }) : null,
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'center', whiteSpace: 'nowrap' }, children: readOnly ? [
									h('span', { style: { cursor: 'pointer', color: '#25a55e', fontSize: '16px', lineHeight: 1, marginRight: '12px' }, onClick: function() { reqsysFetch('/requirements/' + r.id, { method: 'PUT', body: JSON.stringify({ archived: false, progress: '未处理' }) }).then(function() { setReqList(function(list) { return list.map(function(item) { if (item.id !== r.id) return item; return Object.assign({}, item, { archived: false, progress: '未处理' }); }); }); }).catch(function(e) { alert('failed: ' + e.message); }); }, children: '🔄' }),
									h('span', { style: { cursor: 'pointer', color: '#e55', fontSize: '16px', lineHeight: 1 }, onClick: function() { if (confirm('delete this item?')) { reqsysFetch('/requirements/' + r.id, { method: 'DELETE' }).then(function() { setReqList(function(list) { return list.filter(function(item) { return item.id !== r.id; }); }); }).catch(function(e) { alert('delete failed: ' + e.message); }); } }, children: 'x' }),
							] : [
									h('span', { style: { cursor: 'pointer', color: '#8e6bb0', fontSize: '13px', lineHeight: 1, marginRight: '12px' }, onClick: function() { reqsysFetch('/requirements/' + r.id, { method: 'PUT', body: JSON.stringify({ archived: !r.archived }) }).then(function() { setReqList(function(list) { return list.map(function(item) { if (item.id !== r.id) return item; return Object.assign({}, item, { archived: !r.archived }); }); }); }).catch(function(e) { alert('failed: ' + e.message); }); }, children: r.archived ? '📤' : '📦' }),
									h('span', { style: { cursor: 'pointer', color: '#e55', fontSize: '16px', lineHeight: 1 }, onClick: function() { if (confirm('delete this item?')) { reqsysFetch('/requirements/' + r.id, { method: 'DELETE' }).then(function() { setReqList(function(list) { return list.filter(function(item) { return item.id !== r.id; }); }); }).catch(function(e) { alert('delete failed: ' + e.message); }); } }, children: 'x' }),
							] }),
							]});
						}) }),
					]}) }),
				filtered.length > PAGE_SIZE ? h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0 4px', fontSize: '13px', color: '#555' }, children: [
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px' }, onClick: function() { setPageFn(Math.max(0, currentPage - 1)); }, disabled: currentPage === 0, children: '‹ 上一页' }),
					h('span', { style: { fontSize: '12px', color: '#888' }, children: (currentPage + 1) + ' / ' + totalPages + ' 页' }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px' }, onClick: function() { setPageFn(Math.min(totalPages - 1, currentPage + 1)); }, disabled: currentPage >= totalPages - 1, children: '下一页 ›' }),
				]}) : null,
			]})]});
			}

		function ReqsysSelectCell(r, updateReq) {
			if (r.archived) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { style: { fontSize: '12px', color: '#666' }, children: r.progress || '未处理' }) });
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('select', { value: r.progress || '未处理', onChange: function(e) { var newVal = e.target.value; var curVersion = r.version || ''; var curReason = r.reason || ''; if (newVal === '方案设计' || newVal === '已发布') { if (curVersion) { updateReq(r.id, newVal, curVersion, curReason); } else { showEditDialog('输入版本号', curVersion, false).then(function(v) { if (v === null) { e.target.value = r.progress || '未处理'; return; } updateReq(r.id, newVal, v || '', curReason); }); } } else if (newVal === '废弃') { if (curReason) { updateReq(r.id, newVal, curVersion, curReason); } else { showEditDialog('输入废弃原因', curReason, true).then(function(reason) { if (reason === null) { e.target.value = r.progress || '未处理'; return; } updateReq(r.id, newVal, curVersion, reason || ''); }); } } else { updateReq(r.id, newVal, curVersion, curReason); } }, style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }, children: [h('option', { value: '未处理', children: '未处理' }), h('option', { value: '方案设计', children: '方案设计' }), h('option', { value: '已发布', children: '已发布' }), h('option', { value: '废弃', children: '废弃' })] })});
		}

		function ReqsysVersionCell(r, updateReq) {
			var v = r.version || '';
			if (r.archived) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { style: { fontSize: '12px', color: '#666' }, children: v || '-' }) });
			if (!v) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', color: '#ccc', cursor: 'pointer' }, onClick: function() { showEditDialog('输入版本号', '', false).then(function(nv) { if (nv !== null) updateReq(r.id, r.progress || '未处理', nv, r.reason || ''); }); }, children: '点击添加' });
			var cls = r.progress === '已发布' ? 'released' : 'design';
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { className: 'reqsys-version-tag ' + cls, onClick: function() { showEditDialog('修改版本号', v, false).then(function(nv) { if (nv !== null) updateReq(r.id, r.progress || '未处理', nv, r.reason || ''); }); }, children: v }) });
		}

		function ReqsysReasonCell(r, updateReq) {
			var reason = r.reason || '';
			if (r.archived) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { style: { fontSize: '12px', color: '#666' }, children: reason || '-' }) });
			if (!reason) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', color: '#ccc', cursor: 'pointer' }, onClick: function() { showEditDialog('输入废弃原因', '', true).then(function(nr) { if (nr !== null) updateReq(r.id, r.progress || '未处理', r.version || '', nr); }); }, children: '点击填写' });
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { className: 'reqsys-reason-text', onClick: function() { showEditDialog('修改废弃原因', reason, true).then(function(nr) { if (nr !== null) updateReq(r.id, r.progress || '未处理', r.version || '', nr); }); }, children: reason }) });
		}

		// ============================================================================
		// 未竟任务列表组件
		// ============================================================================
		function TaskListView(props) {
			var taskList = props.taskList;
			var setTaskList = props.setTaskList;
			var onClose = props.onClose;

			var taskFilterStatus = useState([]);
			var taskFilterStatusVal = taskFilterStatus[0];
			var setTaskFilterStatus = taskFilterStatus[1];
			var taskFilterSearch = useState('');
			var taskFilterSearchVal = taskFilterSearch[0];
			var setTaskFilterSearch = taskFilterSearch[1];
			var taskPage = useState(0);
			var taskPageVal = taskPage[0];
			var setTaskPage = taskPage[1];
			var TASK_PAGE_SIZE = 15;
			var taskShowArchived = useState(false);
			var taskShowArchivedVal = taskShowArchived[0];
			var setTaskShowArchived = taskShowArchived[1];
			var taskSelectedIdsState = useState([]);
			var taskSelectedIds = taskSelectedIdsState[0];
			var setTaskSelectedIds = taskSelectedIdsState[1];

			var allStatuses = ['未开始', '进行中', '已完成'];

			var filtered = taskList.filter(function(t) {
				if (taskShowArchivedVal ? !t.archived : t.archived) return false;
				if (taskFilterStatusVal.length > 0 && taskFilterStatusVal.indexOf(t.status || '未开始') === -1) return false;
				if (taskFilterSearchVal.trim()) {
					var s = taskFilterSearchVal.trim().toLowerCase();
					var desc = (t.description || '').toLowerCase();
					if (desc.indexOf(s) === -1) return false;
				}
				return true;
			});

			var totalPages = Math.max(1, Math.ceil(filtered.length / TASK_PAGE_SIZE));
			var safePage = Math.min(taskPageVal, totalPages - 1);
			var pageStart = safePage * TASK_PAGE_SIZE;
			var pageItems = filtered.slice(pageStart, pageStart + TASK_PAGE_SIZE);

			useEffect(function() { setTaskPage(0); }, [taskFilterStatusVal, taskFilterSearchVal]);

			function updateTask(id, updates) {
				return reqsysFetch('/tasks/' + id, { method: 'PUT', body: JSON.stringify(updates) }).then(function() {
					setTaskList(function(list) {
						return list.map(function(t) {
							if (t.id !== id) return t;
							return Object.assign({}, t, updates);
						});
					});
				}).catch(function(e) { alert('update failed: ' + e.message); });
			}

			function deleteTask(id) {
				if (confirm('delete this item?')) {
					reqsysFetch('/tasks/' + id, { method: 'DELETE' }).then(function() {
						setTaskList(function(list) { return list.filter(function(t) { return t.id !== id; }); });
					}).catch(function(e) { alert('delete failed: ' + e.message); });
				}
			}

			return h('div', { className: 'reqsys-card-wrap', style: { width: '960px', maxWidth: '95vw' }, children: [
				h('div', { className: 'reqsys-card', style: { height: '70vh', overflowY: 'auto' }, children: [
				h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
						h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '📋 未竟' }),
						h('span', { style: { padding: '4px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: !taskShowArchivedVal ? '#8e6bb0' : '#f0f2f5', color: !taskShowArchivedVal ? '#fff' : '#555' }, onClick: function() { setTaskShowArchived(false); setTaskSelectedIds([]); }, children: '活动中' }),
						h('span', { style: { padding: '4px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: taskShowArchivedVal ? '#8e6bb0' : '#f0f2f5', color: taskShowArchivedVal ? '#fff' : '#555' }, onClick: function() { setTaskShowArchived(true); setTaskSelectedIds([]); }, children: '已归档' }),
					]}),
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
						h('button', { className: 'reqsys-maid-btn', style: { background: '#25a55e', color: '#fff', border: 'none' }, onClick: function() { var BOM = '\uFEFF'; var header = '待办描述,记录时间,截止日期,完成情况' + (taskShowArchivedVal ? ',归档时间' : '') + '\n'; var rows = filtered.map(function(t) { var desc = (t.description || '').replace(/"/g, '""'); return '"' + desc + '",' + fmtTime(t.timestamp) + ',' + (t.deadline || '') + ',' + (t.status || '未开始') + (taskShowArchivedVal ? ',' + (t.archivedAt ? fmtTime(t.archivedAt) : '') : ''); }).join('\n'); var blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '未竟_' + new Date().toISOString().slice(0,10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 CSV' }),
						h('button', { className: 'reqsys-maid-btn', onClick: function() { var blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '未竟_' + new Date().toISOString().slice(0,10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 JSON' }),
					]}),
				]}),
				h('div', { className: 'reqsys-filter-bar', children: [
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '完成情况' }),
						h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' }, children: allStatuses.map(function(s) {
							var active = taskFilterStatusVal.indexOf(s) !== -1;
							return h('span', { key: s, style: { display: 'inline-block', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', background: active ? '#8e6bb0' : '#f0f2f5', color: active ? '#fff' : '#555', border: active ? '1px solid #8e6bb0' : '1px solid #ddd' }, onClick: function() { var idx = taskFilterStatusVal.indexOf(s); if (idx === -1) { setTaskFilterStatus(taskFilterStatusVal.concat([s])); } else { var ns = taskFilterStatusVal.slice(); ns.splice(idx, 1); setTaskFilterStatus(ns); } }, children: s + (active ? ' x' : '') });
						}) }),
					]}),
					h('div', { className: 'filter-group', children: [
						h('span', { className: 'filter-label', children: '搜索' }),
						h('input', { type: 'text', value: taskFilterSearchVal, onChange: function(e) { setTaskFilterSearch(e.target.value); }, placeholder: '搜索待办描述...', style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', width: '300px', boxSizing: 'border-box' } }),
					]}),
					h('span', { className: 'filter-count', children: '共 ' + filtered.length + ' 条' }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 10px', fontSize: '11px', background: taskSelectedIds.length > 0 ? '#8e6bb0' : '#ccc', color: '#fff', border: 'none', alignSelf: 'flex-end' }, onClick: function() { if (taskSelectedIds.length === 0) return; var isArchiving = !taskShowArchivedVal; var label = isArchiving ? '归档' : '重启'; if (!confirm('确认' + label + '选中的 ' + taskSelectedIds.length + ' 条？')) return; var done = 0; taskSelectedIds.forEach(function(id) { var body = isArchiving ? { archived: true } : { archived: false, status: '未开始' }; reqsysFetch('/tasks/' + id, { method: 'PUT', body: JSON.stringify(body) }).then(function() { done++; if (done === taskSelectedIds.length) { reqsysFetch('/tasks').then(function(data) { setTaskList(data || []); setTaskSelectedIds([]); }).catch(function(e) { alert('刷新失败: ' + e.message); }); } }).catch(function(e) { alert(label + '失败: ' + e.message); }); }); }, children: (taskShowArchivedVal ? '🔄 重启选中' : '📦 归档选中') + ' (' + taskSelectedIds.length + ')' }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 10px', fontSize: '11px', color: '#888', border: '1px solid #ddd', background: '#fff', alignSelf: 'flex-end' }, onClick: function() { setTaskFilterStatus([]); setTaskFilterSearch(''); setTaskSelectedIds([]); }, children: '重置' }),
				]}),
				filtered.length === 0
					? h('div', { style: { textAlign: 'center', padding: '40px 20px', color: '#999' }, children: '暂无匹配的未竟之事' })
					: h('div', { style: { overflowX: 'auto' }, children: h('table', { className: 'reqsys-table', children: [
						h('thead', { children: h('tr', { children: [
							h('th', { style: { width: '30px', textAlign: 'center' }, children: '#' }),
							h('th', { style: { width: '28px', textAlign: 'center', verticalAlign: 'middle' }, children: h('input', { type: 'checkbox', checked: filtered.length > 0 && taskSelectedIds.length === filtered.length, onChange: function() { if (taskSelectedIds.length === filtered.length) { setTaskSelectedIds([]); } else { setTaskSelectedIds(filtered.map(function(t) { return t.id; })); } }, style: { cursor: 'pointer', margin: 0, verticalAlign: 'middle' } }) }),
							h('th', { children: '待办描述' }),
							h('th', { style: { width: '90px' }, children: '记录时间' }),
							h('th', { style: { width: '100px' }, children: '截止日期' }),
							h('th', { style: { width: '80px' }, children: '完成情况' }),
							taskShowArchivedVal ? h('th', { style: { width: '90px' }, children: '归档时间' }) : null,
							h('th', { style: { width: '50px' }, children: '操作' }),
						]}) }),
						h('tbody', { children: pageItems.map(function(t, i) {
							var readOnly = taskShowArchivedVal;
							return h('tr', { key: t.id, children: [
								h('td', { style: { padding: '8px 6px', borderBottom: '1px solid #f0f0f0', color: '#999', fontSize: '11px', textAlign: 'center' }, children: pageStart + i + 1 }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'center', verticalAlign: 'middle' }, children: h('input', { type: 'checkbox', checked: taskSelectedIds.indexOf(t.id) !== -1, onChange: function() { var idx = taskSelectedIds.indexOf(t.id); if (idx === -1) { setTaskSelectedIds(taskSelectedIds.concat([t.id])); } else { var ns = taskSelectedIds.slice(); ns.splice(idx, 1); setTaskSelectedIds(ns); } }, style: { cursor: 'pointer', margin: 0, verticalAlign: 'middle' } }) }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', whiteSpace: 'normal', wordBreak: 'break-word', cursor: readOnly ? 'default' : 'pointer' }, onClick: readOnly ? null : function() { showEditDialog('编辑待办描述', t.description, true).then(function(nd) { if (nd === null) return; updateTask(t.id, { description: nd.trim() }); }); }, children: t.description }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }, children: fmtTime(t.timestamp) }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'pointer', color: (function() { if (!t.deadline) return 'inherit'; var now = new Date(); var dl = new Date(t.deadline); var diff = (dl - now) / (1000 * 60 * 60 * 24); if (diff < 2 && t.status !== '已完成') return '#e55'; return 'inherit'; })() }, onClick: readOnly ? null : function(e) { var rect = e.currentTarget.getBoundingClientRect(); var inp = document.createElement('input'); inp.type = 'date'; inp.value = t.deadline || ''; inp.style.position = 'fixed'; inp.style.left = rect.left + 'px'; inp.style.top = rect.bottom + 'px'; inp.style.opacity = '0'; inp.style.pointerEvents = 'none'; inp.style.width = '1px'; inp.style.height = '1px'; document.body.appendChild(inp); inp.addEventListener('change', function() { var val = inp.value; document.body.removeChild(inp); if (val) updateTask(t.id, { deadline: val }); }); inp.addEventListener('blur', function() { if (document.body.contains(inp)) document.body.removeChild(inp); }); setTimeout(function() { inp.showPicker(); }, 10); }, children: t.deadline || '-' }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: readOnly ? h('span', { style: { fontSize: '12px', color: '#888' }, children: t.status || '未开始' }) : h('select', { value: t.status || '未开始', onChange: function(e) { updateTask(t.id, { status: e.target.value }); }, style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }, children: [
									h('option', { value: '未开始', children: '未开始' }),
									h('option', { value: '进行中', children: '进行中' }),
									h('option', { value: '已完成', children: '已完成' }),
								] }) }),
								taskShowArchivedVal ? h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '11px', color: '#999', whiteSpace: 'nowrap' }, children: t.archivedAt ? fmtTime(t.archivedAt) : '' }) : null,
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', textAlign: 'center', whiteSpace: 'nowrap' }, children: readOnly ? [
								h('span', { style: { cursor: 'pointer', color: '#25a55e', fontSize: '16px', lineHeight: 1, marginRight: '12px' }, onClick: function() { reqsysFetch('/tasks/' + t.id, { method: 'PUT', body: JSON.stringify({ archived: false, status: '未开始' }) }).then(function() { setTaskList(function(list) { return list.map(function(item) { if (item.id !== t.id) return item; return Object.assign({}, item, { archived: false, status: '未开始' }); }); }); }).catch(function(e) { alert('failed: ' + e.message); }); }, children: '🔄' }),
								h('span', { style: { cursor: 'pointer', color: '#e55', fontSize: '16px', lineHeight: 1 }, onClick: function() { deleteTask(t.id); }, children: 'x' }),
							] : [
								h('span', { style: { cursor: 'pointer', color: '#8e6bb0', fontSize: '13px', lineHeight: 1, marginRight: '12px' }, onClick: function() { reqsysFetch('/tasks/' + t.id, { method: 'PUT', body: JSON.stringify({ archived: !t.archived }) }).then(function() { setTaskList(function(list) { return list.map(function(item) { if (item.id !== t.id) return item; return Object.assign({}, item, { archived: !t.archived }); }); }); }).catch(function(e) { alert('failed: ' + e.message); }); }, children: t.archived ? '📤' : '📦' }),
								h('span', { style: { cursor: 'pointer', color: '#e55', fontSize: '16px', lineHeight: 1 }, onClick: function() { deleteTask(t.id); }, children: 'x' }),
							] }),
						] });
					}) }),
				] }) }),
				filtered.length > TASK_PAGE_SIZE ? h('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0 4px', fontSize: '13px', color: '#555' }, children: [
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px' }, onClick: function() { setTaskPage(Math.max(0, taskPageVal - 1)); }, disabled: taskPageVal === 0, children: '< ' }),
					h('span', { style: { fontSize: '12px', color: '#888' }, children: (taskPageVal + 1) + ' / ' + totalPages }),
					h('button', { className: 'reqsys-maid-btn', style: { padding: '4px 12px', fontSize: '12px' }, onClick: function() { setTaskPage(Math.min(totalPages - 1, taskPageVal + 1)); }, disabled: taskPageVal >= totalPages - 1, children: ' >' }),
				]}) : null,
			]})]});
		}

		// ============================================================================
		// 插件主体
		// ============================================================================
		const name = 'pet';
		const inject = ['slots'];

		function apply(ctx, config) {
			ctx.slots.inject('shell.overlay', function* () {
				yield ctx.slots.register({
					name: 'shell.overlay',
					id: 'pet',
					order: 1000,
				}, (ownerProps) => h(Pet, { config, ...ownerProps }));
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});