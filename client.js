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
									h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '说出你的梦想' }),
									h('button', { className: 'reqsys-maid-btn', title: '查看愿望清单', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 12px', fontSize: '12px' }, onClick: async () => { setReqView('list'); setReqLoading(true); try { const data = await reqsysFetch('/requirements'); setReqList(data || []); } catch(e) { alert('加载失败: ' + e.message); } setReqLoading(false); }, children: [h('img', { src: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'), style: { width: '20px', height: '20px', display: 'block' } }), '愿望清单'] }),
									]}),
									h('p', { style: { fontSize: '13px', color: '#666', margin: '-8px 0 12px 0' }, children: '支持使用 1. 2. 或 1、 2、 或 - 拆分多条需求' }),
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
								]})]})
								: reqView === 'preview' && reqResult
									? h('div', { className: 'reqsys-card-wrap', style: { width: '700px', maxWidth: '92vw' }, children: [
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
									: reqView === 'list'
										? reqLoading
											? h('div', { className: 'reqsys-card-wrap', style: { width: '960px', maxWidth: '92vw' }, children: [
												h('div', { className: 'reqsys-card', style: { maxHeight: '85vh', overflowY: 'auto' }, children: [
												h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [
													h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '📋 愿望清单' }),
													h('button', { className: 'reqsys-maid-btn', onClick: () => setReqView(null), children: '关闭' }),
												]}),
												h('div', { style: { textAlign: 'center', padding: '40px 20px', color: '#999', fontSize: '14px' }, children: [
													h('div', { style: { fontSize: '32px', marginBottom: '12px' }, children: '⏳' }),
													h('div', { children: '加载中...' }),
												]}),
											]})]})
											: h(ReqsysListView, { reqList: reqList, setReqList: setReqList, reqFilterTags: reqFilterTags, setReqFilterTags: setReqFilterTags, reqFilterProgs: reqFilterProgs, setReqFilterProgs: setReqFilterProgs, reqFilterSearch: reqFilterSearch, setReqFilterSearch: setReqFilterSearch, onClose: function() { setReqView(null); } })
										: null
						})
						: null,
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
			var tagOpen = useState(false);
			var tagOpenVal = tagOpen[0];
			var setTagOpen = tagOpen[1];
			var progOpen = useState(false);
			var progOpenVal = progOpen[0];
			var setProgOpen = progOpen[1];

			var allTags = [];
			var allProgs = ['未处理', '方案设计', '已发布', '废弃'];
			reqList.forEach(function(r) {
				(r.tags || []).forEach(function(t) {
					if (allTags.indexOf(t) === -1) allTags.push(t);
				});
			});

			var filtered = reqList.filter(function(r) {
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
				return true;
			});

			useEffect(function() {
				setPageFn(0);
			}, [reqFilterTags, reqFilterProgs, reqFilterSearch]);

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

			return h('div', { className: 'reqsys-card-wrap', style: { width: '960px', maxWidth: '92vw' }, children: [
				h('div', { className: 'reqsys-card', style: { height: '70vh', overflowY: 'auto' }, children: [
				h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [
					h('h2', { style: { margin: 0, fontSize: '20px', fontWeight: 600 }, children: '📋 愿望清单' }),
					h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, children: [
						h('button', { className: 'reqsys-maid-btn', style: { background: '#25a55e', color: '#fff', border: 'none' }, onClick: function() { var BOM = '\uFEFF'; var header = '记录时间,需求描述,标签,当前进展,版本,废弃原因\n'; var rows = filtered.map(function(r) { var desc = (r.polished || r.original || '').replace(/"/g, '""'); var tags = (r.tags || []).join('; '); return fmtTime(r.timestamp) + ',"' + desc + '",' + tags + ',' + (r.progress || '未处理') + ',' + (r.version || '') + ',' + (r.reason || ''); }).join('\n'); var blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '愿望清单_' + new Date().toISOString().slice(0,10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 CSV' }),
						h('button', { className: 'reqsys-maid-btn', onClick: function() { var blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = '愿望清单_' + new Date().toISOString().slice(0,10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100); }, children: '📥 导出 JSON' }),
						h('button', { className: 'reqsys-maid-btn', style: { background: '#8e6bb0', color: '#fff', border: 'none' }, onClick: function() { reqsysFetch('/rules').then(function(r) { setRules(r || []); setShowRules(true); }).catch(function(e) { alert('加载规则失败: ' + e.message); }); }, children: '⚙ 配置标签' }),
						h('button', { className: 'reqsys-maid-btn', onClick: onClose, children: '关闭' }),
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
						h('span', { className: 'filter-label', children: '搜索' }),
						h('input', { type: 'text', value: reqFilterSearch, onChange: function(e) { setReqFilterSearch(e.target.value); }, placeholder: '搜索需求描述...', style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', width: '440px', boxSizing: 'border-box' } }),
					]}),
					h('span', { className: 'filter-count', children: '共 ' + filtered.length + ' 条' }),
				]}),
				filtered.length === 0
					? h('div', { style: { textAlign: 'center', padding: '40px 20px', color: '#999' }, children: '暂无匹配的需求记录' })
					: h('div', { style: { overflowX: 'auto' }, children: h('table', { className: 'reqsys-table', children: [
						h('thead', { children: h('tr', { children: [
							h('th', { style: { width: '40px' }, children: '#' }),
							h('th', { children: '记录时间' }),
							h('th', { children: '需求描述' }),
							h('th', { children: '标签' }),
							h('th', { style: { width: '100px' }, children: '当前进展' }),
							h('th', { style: { width: '80px' }, children: '版本' }),
							h('th', { style: { width: '80px' }, children: '废弃原因' }),
						]}) }),
						h('tbody', { children: pageItems.map(function(r, i) {
							return h('tr', { key: r.id, children: [
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', color: '#999', fontSize: '11px' }, children: pageStart + i + 1 }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }, children: fmtTime(r.timestamp) }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', whiteSpace: 'normal', wordBreak: 'break-word' }, children: r.polished || r.original || '' }),
								h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: (r.tags || []).map(function(t) {
									return h('span', { key: t, style: { display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, background: '#e8f0fe', color: '#1a5cc8', margin: '1px 2px' }, children: t });
								}) }),
								ReqsysSelectCell(r, updateReq),
								ReqsysVersionCell(r, updateReq),
								ReqsysReasonCell(r, updateReq),
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
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('select', { value: r.progress || '未处理', onChange: function(e) { var newVal = e.target.value; var curVersion = r.version || ''; var curReason = r.reason || ''; if (newVal === '方案设计' || newVal === '已发布') { if (curVersion) { updateReq(r.id, newVal, curVersion, curReason); } else { var v = prompt('输入版本号', curVersion); if (v === null) return; updateReq(r.id, newVal, v || '', curReason); } } else if (newVal === '废弃') { if (curReason) { updateReq(r.id, newVal, curVersion, curReason); } else { var reason = prompt('输入废弃原因', curReason); if (reason === null) return; updateReq(r.id, newVal, curVersion, reason || ''); } } else { updateReq(r.id, newVal, curVersion, curReason); } }, style: { padding: '4px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }, children: [h('option', { value: '未处理', children: '未处理' }), h('option', { value: '方案设计', children: '方案设计' }), h('option', { value: '已发布', children: '已发布' }), h('option', { value: '废弃', children: '废弃' })] })});
		}

		function ReqsysVersionCell(r, updateReq) {
			var v = r.version || '';
			if (!v) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', color: '#ccc', cursor: 'pointer' }, onClick: function() { var nv = prompt('输入版本号', ''); if (nv !== null) updateReq(r.id, r.progress || '未处理', nv, r.reason || ''); }, children: '点击添加' });
			var cls = r.progress === '已发布' ? 'released' : 'design';
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { className: 'reqsys-version-tag ' + cls, onClick: function() { var nv = prompt('修改版本号', v); if (nv !== null) updateReq(r.id, r.progress || '未处理', nv, r.reason || ''); }, children: v }) });
		}

		function ReqsysReasonCell(r, updateReq) {
			var reason = r.reason || '';
			if (!reason) return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', color: '#ccc', cursor: 'pointer' }, onClick: function() { var nr = prompt('输入废弃原因', ''); if (nr !== null) updateReq(r.id, r.progress || '未处理', r.version || '', nr); }, children: '点击填写' });
			return h('td', { style: { padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }, children: h('span', { className: 'reqsys-reason-text', onClick: function() { var nr = prompt('修改废弃原因', reason); if (nr !== null) updateReq(r.id, r.progress || '未处理', r.version || '', nr); }, children: reason }) });
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