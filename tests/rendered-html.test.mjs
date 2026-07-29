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
  assert.match(page, /永久删除项目/);
  assert.match(page, /confirmation\.trim\(\) === project\.name/);
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
  assert.match(page, /确认该文件/);
  assert.match(page, /不代表代码编译、具体器件参数、接线或实物测试已经通过/);
  assert.match(page, /artifacts\/\$\{artifactId\}\/confirmations/);
  assert.match(api, /artifact-review:/);
  assert.match(api, /source_spec_version/);
  assert.match(api, /scope: "content_review"/);
});
