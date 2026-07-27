# Designer Prototype Agent — contributor rules

## Source of truth

1. Before changing a generated project, read its `01_requirements/project-spec.json`.
2. `ProjectSpec` is the only requirements source. Derived BOM, wiring, protocol, code, tests and docs must cite its version.
3. A core requirement change creates a new `ProjectSpec` version, records the reason and lists affected modules. Never silently overwrite an accepted result.

## Engineering integrity

4. Never invent component pins, voltage, current, protocol, I²C address, motor data, supply specifications, prices, inventory or compatibility.
5. Unknown information must be rendered as `待确认`, `尚未验证`, `需要查看数据手册` or `需要用户实物测试`.
6. Every important field keeps `value`, `source`, `confidence`, `verification_status` and `notes`.
7. Protocol changes must update the schema, firmware, Python implementation, tests and documentation together.
8. Hardware changes must rerun pin, voltage, current, power and communication checks.
9. Generated code must be formatted and tested. Run static/type checks and PlatformIO compilation when the tools exist.
10. Never report tests or compilation as passed unless the command actually succeeded. Preserve failure logs and show the failure state.

## Product and safety

11. Keep the UI restrained, clear and consistent. Prefer Microsoft YaHei/微软雅黑 or SimHei/黑体 for Chinese text.
12. Do not add image upload, OCR, image analysis, image generation or any visual-input workflow.
13. Real-hardware surfaces must repeat the first-power-on and high-current safety boundary. Require professional review for mains, high voltage, high temperature, large motors, medical, bodily safety or dangerous machinery.
14. Do not automate unattended physical hardware, purchasing or flashing.

## Architecture discipline

15. The main `Prototype Engineer Orchestrator` coordinates small skills. Add a skill only after it demonstrates stable value in the smart-focus-ring case.
16. Do not over-design for hypothetical scale. Complete and maintain the runnable vertical workflow first.
17. Model providers live behind `ModelProvider`; model names and credentials come only from configuration.
18. Precise checks belong in deterministic code. Models handle ambiguous interpretation, candidates, code drafts and explanations.
19. Generated files belong in the documented project workspace and must be registered as artifacts.

## Required checks

- Web: `pnpm lint`, `pnpm test`, `pnpm build`
- API: `pytest` from `apps/api`
- Example: `python scripts/generate_example.py` from `apps/api`
- Firmware: `pio run` inside the generated `04_firmware` directory when PlatformIO is available
