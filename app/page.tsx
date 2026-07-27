"use client";

import {
  AlertTriangle, ArrowRight, Bot, Box, Check, ChevronRight, CircleDollarSign,
  ClipboardCheck, Code2, Cpu, Download, FileCode2, FileText, GitBranch, Home,
  Layers3, Menu, PackageSearch, Plus, RotateCcw, Send, Settings2, ShieldCheck,
  Sparkles, TestTube2, Unplug, X, Zap,
} from "lucide-react";
import { FormEvent, useState } from "react";

type Tone = "done" | "active" | "waiting" | "neutral" | "danger";
const nav = [
  ["项目概览", Home], ["需求", FileText], ["系统架构", GitBranch], ["硬件方案", Cpu],
  ["BOM", PackageSearch], ["接线", Unplug], ["通信协议", Layers3], ["固件代码", Code2],
  ["Python 程序", FileCode2], ["控制界面", Settings2], ["测试", TestTube2],
  ["文档", FileText], ["验证记录", ClipboardCheck],
] as const;
const phases: [string, Tone, string][] = [
  ["需求分析", "done", "已确认"], ["系统架构", "done", "已生成"], ["硬件方案", "active", "待核对"],
  ["软件生成", "waiting", "等待硬件"], ["工程验证", "neutral", "未开始"], ["实物测试", "neutral", "未开始"],
];
const bom = [
  ["主控", "ESP32-S3 开发板", "1", "待查询", "待核对数据手册"],
  ["输入", "增量式旋转编码器", "1", "待查询", "待确认型号"],
  ["执行", "阻尼执行器／电机", "1", "待查询", "需要方案实验"],
  ["驱动", "匹配电机驱动模块", "1", "待查询", "依赖电机选型"],
  ["保护", "急停与保险保护模块", "1", "待查询", "等待确认"],
];
const protocol = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "protocol_version": "1.0.0",
  "transport": "usb_serial",
  "framing": "newline_delimited_json",
  "baud_rate": 115200,
  "max_message_bytes": 512,
  "required_fields": ["type", "request_id"],
  "commands": {
    "set_damping": {
      "payload": { "level": "integer:0..100" },
      "timeout_ms": 1000,
      "max_retries": 2
    }
  }
}`;

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

export default function HomePage() {
  const [active, setActive] = useState("项目概览");
  const [agentOpen, setAgentOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    { role: "agent", text: "硬件方案已生成。阻尼执行器的具体型号会同时影响驱动器、电源预算和机械安全，已标记为必须确认。" },
  ]);

  function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setMessages((items) => [...items, { role: "user", text: message.trim() }, {
      role: "agent", text: "已分析修改影响：ProjectSpec、BOM、接线表、电源预算、固件和测试计划需要更新。系统会先创建需求版本，不会静默覆盖已验证结果。",
    }]);
    setMessage("");
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Box size={18} /></span><div><strong>智能产品原型工程师</strong><small>Designer Prototype Agent</small></div></div>
        <div className="actions">
          <button className="button secondary compact" onClick={() => setAgentOpen(!agentOpen)}><Bot size={16} /> Agent</button>
          <button className="button primary compact" onClick={() => setCreateOpen(true)}><Plus size={16} /> 新建项目</button>
          <button className="icon mobile" onClick={() => setMobileNav(!mobileNav)} aria-label="导航"><Menu size={20} /></button>
        </div>
      </header>

      <div className={`workspace ${agentOpen ? "" : "no-agent"}`}>
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="project-switcher"><span>专</span><div><strong>智能专注指环</strong><small>原型 ID · DPA-001</small></div><ChevronRight size={15} /></div>
          <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? "selected" : ""} onClick={() => { setActive(label); setMobileNav(false); }}><Icon size={17} />{label}{label === "验证记录" && <em>3</em>}</button>)}</nav>
          <div className="safety"><ShieldCheck size={18} /><div><strong>原型安全边界</strong><p>首次上电前必须人工检查接线。Agent 不能替代专业电气安全评审。</p></div></div>
        </aside>

        <section className="content">
          {active === "项目概览" && <Overview setActive={setActive} />}
          {active === "BOM" && <Module title="BOM 与成本" kicker="硬件资产" description="未从可靠来源核对的价格与规格均保持待确认状态。">
            <div className="summary">{[["预算上限", "¥1,500"], ["已确认成本", "¥0"], ["待确认成本", "5 项"]].map(([a,b]) => <div key={a}><span>{a}</span><strong>{b}</strong></div>)}<div><span>预算状态</span><Badge tone="waiting">无法计算</Badge></div></div>
            <div className="table"><table><thead><tr>{["分类","器件","数量","预估单价","验证状态"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{bom.map(row => <tr key={row[1]}>{row.map((cell,i) => <td key={cell}>{i === 4 ? <Badge tone="waiting">{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div>
          </Module>}
          {active === "通信协议" && <Module title="USB 串口协议" kicker="协议 1.0.0" description="固件与 Python 端由同一份 Schema 约束，采用换行分隔 JSON。"><div className="code"><div><span>protocol.schema.json</span><button className="button secondary compact">复制</button></div><pre>{protocol}</pre></div></Module>}
          {!["项目概览","BOM","通信协议"].includes(active) && <Module title={active} kicker="工程模块" description="该资产由当前 ProjectSpec 生成，并保留来源、版本和验证状态。"><div className="empty"><span><Layers3 size={24} /></span><h2>{active}资产已准备</h2><p>生成或重新验证会记录本次运行、修改文件及受影响模块，不会静默覆盖已确认版本。</p><button className="button primary"><Sparkles size={16} /> 生成当前模块</button></div></Module>}
        </section>

        {agentOpen && <aside className="agent">
          <div className="agent-head"><div><span><Bot size={17} /></span><div><strong>Prototype Engineer</strong><small>● Mock 模式可用</small></div></div><button className="icon" onClick={() => setAgentOpen(false)}><X size={18} /></button></div>
          <div className="context"><GitBranch size={15} />理解当前项目 · ProjectSpec v3</div>
          <div className="chat">{messages.map((item,i) => <div className={`message ${item.role}`} key={i}>{item.role === "agent" && <span><Bot size={14} /></span>}<p>{item.text}</p></div>)}<div className="impact"><small>本次方案关联</small><div>{["ProjectSpec","BOM","电源预算","接线表","测试计划"].map(x => <em key={x}>{x}</em>)}</div></div></div>
          <form className="composer" onSubmit={send}><textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="例如：预算降到 1000 元以内…" /><div><small>Enter 发送</small><button><Send size={16} /></button></div></form>
        </aside>}
      </div>

      {createOpen && <CreateModal step={step} setStep={setStep} close={() => setCreateOpen(false)} />}
    </main>
  );
}

function Overview({ setActive }: { setActive: (name: string) => void }) {
  return <><PageHead title="智能专注指环" kicker="● 硬件方案阶段" description="通过旋转行为采集与自适应阻尼反馈，帮助用户建立稳定的专注状态。"><button className="button secondary"><Download size={16} /> 导出工程包</button><button className="button primary" onClick={() => setActive("硬件方案")}>继续开发 <ArrowRight size={16} /></button></PageHead>
    <section className="card phase-card"><Title kicker="开发路径" title="从需求到实物验证" extra={<small>完成 2 / 6</small>} /><div className="phases">{phases.map(([name,tone,detail],i) => <div className={`phase ${tone}`} key={name}><div><span>{tone === "done" ? <Check size={13} /> : i+1}</span>{i < 5 && <i />}</div><strong>{name}</strong><small>{detail}</small></div>)}</div></section>
    <div className="metrics">
      <Metric icon={<Sparkles />} tone="blue" label="下一步建议" value="确认阻尼执行器方案" />
      <Metric icon={<AlertTriangle />} tone="amber" label="待确认与风险" value="3 项需要处理" />
      <Metric icon={<CircleDollarSign />} tone="green" label="BOM 预算" value="¥1,500 上限" />
      <Metric icon={<Code2 />} tone="violet" label="代码状态" value="等待硬件确认" />
    </div>
    <div className="columns">
      <section className="card panel"><Title kicker="ProjectSpec" title="需求事实源" extra={<button className="link" onClick={() => setActive("需求")}>查看全部 <ChevronRight size={14} /></button>} /><div className="facts">{[["主控","ESP32-S3","待核对","waiting"],["通信","USB 串口 · JSONL","已确认","done"],["预算","不超过 ¥1,500","用户提供","done"],["机器学习","基础状态分类","Agent 推断","active"]].map(([a,b,c,d]) => <div key={a}><span>{a}</span><strong>{b}</strong><Badge tone={d as Tone}>{c}</Badge></div>)}</div></section>
      <section className="card panel"><Title kicker="风险队列" title="优先处理" extra={<Badge tone="danger">1 项高优先级</Badge>} /><div className="risks"><Risk icon={<AlertTriangle />} title="执行器规格尚未验证" text="需要实验比较阻尼范围与启动电流" /><Risk icon={<Zap />} title="电源预算不完整" text="等待执行器额定及峰值电流" /><Risk icon={<Cpu />} title="开发板 GPIO 待核对" text="以实际板卡数据手册为准" /></div></section>
    </div>
  </>;
}

function PageHead({ title,kicker,description,children }: { title:string;kicker:string;description:string;children?:React.ReactNode }) { return <div className="page-head"><div><div className="kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div><div className="actions">{children}</div></div>; }
function Title({ kicker,title,extra }: { kicker:string;title:string;extra:React.ReactNode }) { return <div className="title-row"><div><span className="kicker">{kicker}</span><h2>{title}</h2></div>{extra}</div>; }
function Metric({ icon,tone,label,value }: { icon:React.ReactNode;tone:string;label:string;value:string }) { return <article className="metric"><span className={tone}>{icon}</span><div><small>{label}</small><strong>{value}</strong></div><ChevronRight size={17} /></article>; }
function Risk({ icon,title,text }: { icon:React.ReactNode;title:string;text:string }) { return <div className="risk">{icon}<div><strong>{title}</strong><small>{text}</small></div></div>; }
function Module({ title,kicker,description,children }: { title:string;kicker:string;description:string;children:React.ReactNode }) { return <><PageHead title={title} kicker={kicker} description={description}><button className="button secondary"><RotateCcw size={16} /> 重新验证</button><button className="button primary"><Sparkles size={16} /> 重新生成</button></PageHead>{children}</>; }
function Field({ label, placeholder, area=false }: { label:string;placeholder:string;area?:boolean }) { return <label className="field"><span>{label}</span>{area ? <textarea placeholder={placeholder} /> : <input placeholder={placeholder} />}</label>; }

function CreateModal({ step,setStep,close }: { step:number;setStep:(n:number)=>void;close:()=>void }) {
  const titles = ["产品目标","交互与功能","技术偏好","现实约束","确认需求"];
  return <div className="backdrop"><div className="modal-box"><header><div><span className="kicker">新建项目 · {step}/5</span><h2>{titles[step-1]}</h2></div><button className="icon" onClick={close}><X size={20} /></button></header><div className="steps">{[1,2,3,4,5].map(n => <i className={n <= step ? "filled" : ""} key={n} />)}</div><div className="form-body">
    {step === 1 && <><Field label="项目名称" placeholder="例如：桌面呼吸灯原型" /><Field label="产品概念与要解决的问题" area placeholder="描述产品、目标用户与核心问题…" /><div className="field-row"><Field label="目标用户" placeholder="例如：长时间伏案的设计师" /><Field label="使用场景" placeholder="例如：室内桌面" /></div></>}
    {step === 2 && <><Field label="用户如何操作" area placeholder="描述按、旋转、移动或其他操作…" /><Field label="产品感知与反馈" area placeholder="描述输入、判断逻辑与输出反馈…" /><Field label="异常情况" placeholder="例如：传感器断开、执行器卡住" /></>}
    {step === 3 && <><div className="choices">{["ESP32","Arduino","树莓派","由 Agent 推荐"].map((x,i) => <button className={i===0?"picked":""} key={x}><Cpu size={18} />{x}{i===0&&<Check size={15}/>}</button>)}</div><div className="toggles">{["需要 Python 上位机","需要基础机器学习","需要 Web 控制界面"].map((x,i)=><label key={x}>{x}<input type="checkbox" defaultChecked={i!==1}/></label>)}</div></>}
    {step === 4 && <><div className="field-row"><Field label="预算（人民币）" placeholder="1500" /><Field label="开发经验" placeholder="初学者" /></div><Field label="已有硬件" placeholder="没有可留空" /><div className="field-row"><Field label="尺寸限制" placeholder="待确认" /><Field label="供电限制" placeholder="USB 5V" /></div><label className="check"><input type="checkbox" defaultChecked /> 第一版避免定制 PCB</label></>}
    {step === 5 && <div className="confirm"><span><Check size={22}/></span><h3>ProjectSpec 初稿已就绪</h3><p>创建后保存原始描述与 v1 需求版本。未填写的工程参数标记为“待确认”，不会自动编造。</p><div><em><Check size={14}/>结构化需求</em><em><Check size={14}/>来源标记</em><em><Check size={14}/>澄清问题</em></div></div>}
  </div><footer><button className="button secondary" disabled={step===1} onClick={()=>setStep(Math.max(1,step-1))}>上一步</button>{step<5?<button className="button primary" onClick={()=>setStep(step+1)}>下一步 <ArrowRight size={16}/></button>:<button className="button primary" onClick={close}><Sparkles size={16}/>创建并解析需求</button>}</footer></div></div>;
}
