import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workbench contains the engineering workflow and no visual upload", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /项目概览/);
  assert.match(source, /ProjectSpec/);
  assert.match(source, /BOM 与成本/);
  assert.match(source, /Prototype Engineer/);
  assert.match(source, /首次上电前必须人工检查接线/);
  assert.doesNotMatch(source, /图片上传|草图上传|OCR/);
});

test("starter preview markers are removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /智能产品原型工程师/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("visual workbench preserves the original empty-project structure without invented branding", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /home-empty/);
  assert.match(page, /创建第一个智能产品原型/);
  assert.match(page, /initial-view/);
  assert.match(page, /Designer Prototype Agent 标志/);
  assert.match(page, /IntroCover/);
  assert.match(page, /intro-logo-piece top/);
  assert.match(page, /intro-logo-piece right/);
  assert.match(page, /intro-logo-piece bottom/);
  assert.match(page, /intro-logo-piece left/);
  assert.match(page, /任意点击进入工作台/);
  assert.match(page, /intro-translate-x/);
  assert.match(css, /\.app-shell/);
  assert.match(css, /\.home-empty/);
  assert.match(css, /\.brand-symbol/);
  assert.match(css, /designer-prototype-agent-symbol\.png/);
  assert.match(css, /\.intro-cover\.leaving \.intro-logo/);
  assert.match(css, /@keyframes intro-logo-piece-top/);
  assert.match(css, /@keyframes intro-logo-piece-right/);
  assert.match(css, /@keyframes intro-logo-piece-bottom/);
  assert.match(css, /@keyframes intro-logo-piece-left/);
  assert.match(css, /@keyframes intro-logo-lock/);
  assert.match(css, /translate 980ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /scale 980ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /\.app-root\.initial-view\s*\{\s*padding: 0;/);
  assert.match(css, /\.initial-view \.app-shell[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /\.app-root\s*\{[\s\S]*?padding: 0;/);
  assert.match(css, /\.app-shell\s*\{[\s\S]*?width: 100%;[\s\S]*?min-height: 100vh;[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(page, /geometry-(stage|disc|sphere|capsule|chip)/);
  assert.doesNotMatch(page, /brand-mark/);
  assert.doesNotMatch(page, /landing-shell|workflow-overview/);
});

test("requirements are confirmed inside the guided conversation and dropdowns are controlled", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /ConversationCheckpoint/);
  assert.match(page, /需要你的确认 · ProjectSpec/);
  assert.match(page, /确认并推进/);
  assert.match(page, /spec\/confirmations/);
  assert.match(page, /让 Agent 推荐 3 个候选/);
  assert.match(page, /选择此方案并确认/);
  assert.match(page, /spec\/recommendations/);
  assert.match(page, /Workflow 实时状态/);
  assert.match(page, /aria-haspopup="listbox"/);
  assert.doesNotMatch(page, /<select/);
  assert.doesNotMatch(page, /<details/);
});

test("projects can be deleted only after explicit name confirmation", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /确认永久删除/);
  assert.match(page, /confirmation\.trim\(\) === project\.name/);
  assert.match(page, /删除当前项目/);
  assert.match(page, /确认删除项目？/);
  assert.match(page, /继续，进行二次确认/);
  assert.match(page, /第二次确认：请输入项目名称/);
  assert.match(page, /method: "DELETE"/);
  assert.match(api, /parts\.length === 3 && method === "DELETE"/);
  assert.match(api, /DELETE FROM projects WHERE id = \? AND owner = \?/);
});

test("derived module confirmations live in conversation while module pages remain read-only", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /ArtifactReviewStatus/);
  assert.match(page, /对话中的工程文件确认/);
  assert.match(page, /确认前请检查/);
  assert.match(page, /当前页面仅用于查看工程内容/);
  assert.match(page, /准备、生成、修改、确认和验证操作已统一移至项目概览/);
  for (const moduleName of [
    "系统架构",
    "硬件方案",
    "BOM",
    "接线",
    "通信协议",
    "固件代码",
    "Python 程序",
    "控制界面",
    "测试",
    "文档",
  ]) {
    assert.match(page, new RegExp(JSON.stringify(moduleName).slice(1, -1)));
  }
  assert.match(page, /确认文件/);
  assert.match(page, /“确认内容”不等于“验证真实工程结果”/);
  assert.match(page, /artifacts\/\$\{artifactId\}\/confirmations/);
  assert.match(api, /artifact-review:/);
  assert.match(api, /source_spec_version/);
  assert.match(api, /scope: "content_review"/);
  assert.match(api, /recordWorkflowConversation/);
});

test("overview is conversation-first and no longer renders the duplicated dashboard cards", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /conversation-stage/);
  assert.match(page, /buildWorkflowStages/);
  assert.match(page, /agent-orb/);
  assert.doesNotMatch(page, /<section className="card phase-card">/);
  assert.doesNotMatch(page, /<div className="metrics">/);
  assert.doesNotMatch(page, /<div className="columns">/);
  assert.match(css, /@keyframes orb-organic-breathe/);
  assert.match(css, /@keyframes orb-aura-morph/);
  assert.match(css, /@keyframes orb-signal/);
  assert.match(css, /@keyframes orb-light-flow/);
  assert.match(css, /@keyframes orb-gaze/);
  assert.match(css, /@keyframes orb-eye-blink/);
  assert.match(css, /@keyframes orb-white-halo/);
  assert.match(css, /@keyframes orb-thinking-halo/);
  assert.match(css, /@keyframes orb-thinking-signal/);
  assert.match(css, /@keyframes orb-thinking-eye-left/);
  assert.match(css, /@keyframes orb-thinking-eye-right/);
  assert.match(css, /\.agent-orb b::before/);
  assert.match(page, /<em \/>/);
  assert.doesNotMatch(css, /@keyframes orb-rotate/);
  assert.match(css, /\.workflow-state\.waiting/);
});

test("the primary workflow is plan-driven conversation with explicit tool confirmation", async () => {
  const [page, api, types, generator] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/generator.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /PlanningCreateModal/);
  assert.match(page, /让 Agent 先规划/);
  assert.match(page, /模糊意图识别/);
  assert.match(page, /需要你选择的推测/);
  assert.match(page, /建议调用的工具/);
  assert.match(page, /确认计划并创建项目/);
  assert.match(page, /apply_change: applyChange/);
  assert.match(page, /确认前不会改写 ProjectSpec/);
  assert.match(api, /url\.pathname === "\/api\/planning"/);
  assert.match(api, /normalizeProjectPlan/);
  assert.match(api, /suggested_tools/);
  assert.match(api, /proposal_pending/);
  assert.match(api, /open-requirements/);
  assert.match(api, /不要主动推荐或猜测预算数字/);
  assert.match(types, /ConversationToolCall/);
  assert.match(types, /ProjectPlan/);
  assert.match(generator, /defaultBool/);
  assert.match(generator, /\["待确认", "由 Agent 推荐"\]/);
});
