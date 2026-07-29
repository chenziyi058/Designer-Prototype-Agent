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
  assert.match(page, /任意点击进入工作台/);
  assert.match(page, /intro-translate-x/);
  assert.match(css, /\.app-shell/);
  assert.match(css, /\.home-empty/);
  assert.match(css, /\.brand-symbol/);
  assert.match(css, /designer-prototype-agent-symbol\.png/);
  assert.match(css, /\.intro-cover\.leaving \.intro-logo/);
  assert.match(css, /translate 980ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /scale 980ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /\.app-root\.initial-view\s*\{\s*padding: 0;/);
  assert.match(css, /\.initial-view \.app-shell[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(page, /geometry-(stage|disc|sphere|capsule|chip)/);
  assert.doesNotMatch(page, /brand-mark/);
  assert.doesNotMatch(page, /landing-shell|workflow-overview/);
});

test("requirements can be explicitly confirmed and dropdowns are controlled", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /确认并创建新版本/);
  assert.match(page, /确认回答/);
  assert.match(page, /spec\/confirmations/);
  assert.match(page, /DeepSeek 推荐 3 个候选/);
  assert.match(page, /选择此方案并确认/);
  assert.match(page, /spec\/recommendations/);
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

test("derived module files have a persistent user confirmation interface", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /ArtifactConfirmationPanel/);
  assert.match(page, /你正在确认什么/);
  assert.match(page, /文件用途/);
  assert.match(page, /建议核对/);
  assert.match(page, /确认后的影响/);
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
  assert.match(page, /确认该文件/);
  assert.match(page, /“确认内容”与“验证工程结果”是两件不同的事/);
  assert.match(page, /artifacts\/\$\{artifactId\}\/confirmations/);
  assert.match(api, /artifact-review:/);
  assert.match(api, /source_spec_version/);
  assert.match(api, /scope: "content_review"/);
});
