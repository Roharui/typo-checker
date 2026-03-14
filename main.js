'use strict';

const { Plugin, PluginSettingTab, Setting } = require('obsidian');
const { Decoration, ViewPlugin, EditorView } = require('@codemirror/view');
const { RangeSetBuilder, Annotation } = require('@codemirror/state');

const skipReplaceAnnotation = Annotation.define();

// ──────────────────────────────────────────
//  기본 설정값
// ──────────────────────────────────────────
const DEFAULT_SETTINGS = {
	patterns: [
		{ text: 'TODO',  color: '#ffd700', enabled: true,  isRegex: false, autoReplace: false, replacement: '' },
		{ text: 'FIXME', color: '#ff6b6b', enabled: true,  isRegex: false, autoReplace: false, replacement: '' },
	],
};

// ──────────────────────────────────────────
//  플러그인 본체
// ──────────────────────────────────────────
class CharHighlighterPlugin extends Plugin {

	async onload() {
		await this.loadSettings();

		// Live Preview / Source mode — CodeMirror 6 데코레이션
		this.registerEditorExtension(this.buildEditorExtension());

		// Live Preview / Source mode — 자동 교체
		this.registerEditorExtension(this.buildAutoReplaceExtension());

		// Reading mode — DOM 후처리
		this.registerMarkdownPostProcessor((el) => this.applyHighlightsToElement(el));

		// 설정 탭
		this.addSettingTab(new CharHighlighterSettingTab(this.app, this));
	}

	// ── CodeMirror 6 자동 교체 Extension ────────────────────────────────
	buildAutoReplaceExtension() {
		const self = this;

		return EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			// IME 조합 중(한글·중국어 등)에는 교체 금지 — 버퍼 잔여 문자 삽입 방지
			if (update.view.composing) return;
			// 자체 교체 트랜잭션은 무시 (무한 루프 방지)
			if (update.transactions.some((tr) => tr.annotation(skipReplaceAnnotation))) return;

			const patterns = self._activeAutoReplacePatterns();
			if (patterns.length === 0) return;

			const doc = update.state.doc;
			const changes = [];
			const checkedRanges = new Set();

			update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
				// 변경 지점 주변을 넉넉하게 검사
				const checkFrom = Math.max(0, fromB - 50);
				const checkTo   = Math.min(doc.length, toB + 50);
				const key = `${checkFrom}:${checkTo}`;
				if (checkedRanges.has(key)) return;
				checkedRanges.add(key);

				const text = doc.sliceString(checkFrom, checkTo);

				for (const pat of patterns) {
					const regex = self._makeRegex(pat);
					if (!regex) continue;
					let m;
					while ((m = regex.exec(text)) !== null) {
						const absFrom = checkFrom + m.index;
						const absTo   = absFrom + m[0].length;
						if (m[0] !== pat.replacement) {
							changes.push({ from: absFrom, to: absTo, insert: pat.replacement });
						}
					}
				}
			});

			if (changes.length === 0) return;

			// 오름차순 정렬 후 겹치는 범위 제거
			changes.sort((a, b) => a.from - b.from);
			const deduped = [];
			let lastTo = -1;
			for (const c of changes) {
				if (c.from >= lastTo) {
					deduped.push(c);
					lastTo = c.to;
				}
			}

			update.view.dispatch({
				changes: deduped,
				annotations: skipReplaceAnnotation.of(true),
			});
		});
	}

	// ── CodeMirror 6 ViewPlugin ──────────────────────────────────────────
	buildEditorExtension() {
		const self = this;

		return ViewPlugin.fromClass(
			class {
				constructor(view) {
					this.decorations = self._buildDecorations(view);
				}

				update(update) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = self._buildDecorations(update.view);
					}
				}
			},
			{ decorations: (v) => v.decorations },
		);
	}

	_buildDecorations(view) {
		const builder  = new RangeSetBuilder();
		const patterns = this._activePatterns();

		if (patterns.length === 0) return builder.finish();

		const allMatches = [];

		for (const { from, to } of view.visibleRanges) {
			const text = view.state.doc.sliceString(from, to);

			for (const pat of patterns) {
				const regex = this._makeRegex(pat);
				if (!regex) continue;

				let m;
				while ((m = regex.exec(text)) !== null) {
					allMatches.push({
						from:  from + m.index,
						to:    from + m.index + m[0].length,
						color: pat.color,
					});
				}
			}
		}

		// RangeSetBuilder 는 오름차순 정렬이 필수
		allMatches.sort((a, b) => a.from - b.from || a.to - b.to);

		// 겹치는 범위 제거 (첫 번째 패턴 우선)
		let lastTo = -1;
		for (const { from, to, color } of allMatches) {
			if (from >= lastTo) {
				builder.add(
					from,
					to,
					Decoration.mark({
						attributes: {
							style: `background-color: ${color}; border-radius: 3px; padding: 0 2px;`,
						},
					}),
				);
				lastTo = to;
			}
		}

		return builder.finish();
	}

	// ── Reading mode 하이라이트 ────────────────────────────────────────────
	applyHighlightsToElement(el) {
		const patterns = this._activePatterns();
		if (patterns.length === 0) return;

		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
		const textNodes = [];
		let node;
		while ((node = walker.nextNode())) textNodes.push(node);

		for (const textNode of textNodes) {
			this._highlightTextNode(textNode, patterns);
		}
	}

	_highlightTextNode(textNode, patterns) {
		const original = textNode.textContent;
		const fragment = document.createDocumentFragment();
		let remaining   = original;

		while (remaining.length > 0) {
			let bestIndex  = Infinity;
			let bestMatch  = null;
			let bestColor  = '';

			for (const pat of patterns) {
				const regex = this._makeRegex(pat);
				if (!regex) continue;
				const m = regex.exec(remaining);
				if (m && m.index < bestIndex) {
					bestIndex = m.index;
					bestMatch = m[0];
					bestColor = pat.color;
				}
			}

			if (bestMatch === null) {
				fragment.appendChild(document.createTextNode(remaining));
				break;
			}

			// 매치 앞 텍스트
			if (bestIndex > 0) {
				fragment.appendChild(document.createTextNode(remaining.slice(0, bestIndex)));
			}

			// 하이라이트 span
			const span = document.createElement('span');
			span.className = 'char-highlighter-match';
			span.style.backgroundColor = bestColor;
			span.style.borderRadius     = '3px';
			span.style.padding          = '0 2px';
			span.textContent = bestMatch;
			fragment.appendChild(span);

			remaining = remaining.slice(bestIndex + bestMatch.length);
		}

		textNode.parentNode.replaceChild(fragment, textNode);
	}

	// ── 유틸 ────────────────────────────────────────────────────────────
	_activePatterns() {
		return (this.settings.patterns || []).filter((p) => p.enabled && p.text);
	}

	_activeAutoReplacePatterns() {
		return (this.settings.patterns || []).filter(
			(p) => p.enabled && p.autoReplace && p.text && p.replacement !== undefined,
		);
	}

	_makeRegex(pat) {
		try {
			const src = pat.isRegex
				? pat.text
				: pat.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return new RegExp(src, 'g');
		} catch {
			return null; // 잘못된 정규식은 무시
		}
	}

	// ── 데이터 저장/불러오기 ────────────────────────────────────────────
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ──────────────────────────────────────────
//  설정 탭
// ──────────────────────────────────────────
class CharHighlighterSettingTab extends PluginSettingTab {

	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '문자 하이라이터 설정' });
		containerEl.createEl('p', {
			text: '감지할 문자·단어를 추가하고 색상을 지정하세요. 정규식(Regex) 모드를 켜면 정규 표현식을 사용할 수 있습니다.',
			cls: 'setting-item-description',
		});

		// 새 패턴 추가 버튼
		new Setting(containerEl)
			.setName('새 패턴 추가')
			.addButton((btn) =>
				btn
					.setButtonText('+ 추가')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.patterns.push({
							text:        '',
							color:       '#ffd700',
							enabled:     true,
							isRegex:     false,
							autoReplace: false,
							replacement: '',
						});
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		containerEl.createEl('hr');

		// 패턴 목록
		this.plugin.settings.patterns.forEach((pattern, index) => {
			const setting = new Setting(containerEl)
				.setName(`패턴 ${index + 1}`)
				// 활성화 토글
				.addToggle((toggle) =>
					toggle
						.setTooltip('활성화')
						.setValue(pattern.enabled)
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].enabled = val;
							await this.plugin.saveSettings();
						}),
				)
				// 감지 패턴 입력
				.addText((text) =>
					text
						.setPlaceholder('감지할 문자 또는 정규식')
						.setValue(pattern.text)
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].text = val;
							await this.plugin.saveSettings();
						}),
				)
				// 색상 선택
				.addColorPicker((picker) =>
					picker
						.setValue(pattern.color)
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].color = val;
							await this.plugin.saveSettings();
						}),
				)
				// 정규식 토글
				.addToggle((toggle) =>
					toggle
						.setTooltip('정규식(Regex) 사용')
						.setValue(pattern.isRegex)
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].isRegex = val;
							await this.plugin.saveSettings();
						}),
				)
				// 삭제 버튼
				.addButton((btn) =>
					btn
						.setButtonText('삭제')
						.setWarning()
						.onClick(async () => {
							this.plugin.settings.patterns.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			// 정규식 여부 레이블
			setting.descEl.setText(pattern.isRegex ? '정규식 모드' : '일반 텍스트 모드');

			// ── 자동 교체 행 ──────────────────────────────────────────────
			new Setting(containerEl)
				.setName('')
				.setDesc('자동 교체')
				// 자동 교체 활성화 토글
				.addToggle((toggle) =>
					toggle
						.setTooltip('자동 교체 사용')
						.setValue(pattern.autoReplace || false)
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].autoReplace = val;
							await this.plugin.saveSettings();
						}),
				)
				// 교체 문자 입력
				.addText((text) =>
					text
						.setPlaceholder('교체할 문자 (비워두면 삭제)')
						.setValue(pattern.replacement || '')
						.onChange(async (val) => {
							this.plugin.settings.patterns[index].replacement = val;
							await this.plugin.saveSettings();
						}),
				);

			containerEl.createEl('hr', { cls: 'char-highlighter-divider' });
		});
	}
}

module.exports = CharHighlighterPlugin;
