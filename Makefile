# RegZero（零号寄存器）— 根目录构建与质量门禁入口
#
# 常用命令：
#   make wasm         编译 crates/regzero-wasm 到 web/src/wasm-pkg（release）
#   make web-dev      启动前端开发服务器（http://localhost:5173）
#   make web-build    构建前端生产产物（web/dist）
#   make test         运行全仓 Rust 测试 + 关卡自检 + 前端单测
#   make check        运行全套质量门禁（Rust + Web typecheck/lint/test/build）

.PHONY: help wasm web-install web-dev web-build web-check test selfcheck check

.DEFAULT_GOAL := help

help:
	@echo "RegZero targets:"
	@echo "  make wasm         Build regzero-wasm (release) into web/src/wasm-pkg"
	@echo "  make web-install  Install npm dependencies in web/"
	@echo "  make web-dev      Start Vite dev server"
	@echo "  make web-build    Build production web bundle"
	@echo "  make selfcheck    Run level selfcheck and consistency tests"
	@echo "  make test         Run all Rust and Web tests"
	@echo "  make check        Run full quality gates (Rust + Web)"

wasm:
	rm -rf web/src/wasm-pkg
	wasm-pack build crates/regzero-wasm --target web --out-dir ../../web/src/wasm-pkg --release

web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

web-check:
	cd web && npm run typecheck && npm run lint && npm run test && npm run build

selfcheck:
	cargo test -p regzero-core selfcheck -- --nocapture
	cargo test -p regzero-core every_level_page_and_test_config_are_consistent

test:
	cargo test --workspace
	cd web && npm run test

check: wasm selfcheck test web-check
