# POLITICA 画像生成（GPT Codex 連携）

他のゲーム制作と同様、**APIキー不要**で OpenAI Codex デスクトップ版の組み込み `image_gen`
ツールを使い、カード／紋章のイラストを自動生成する。

## 前提
- OpenAI Codex デスクトップ版がインストール済みで `codex login` 済みであること。
- ランナーは `codex.exe` を `~/AppData/Local/OpenAI/Codex/bin/<hash>/codex.exe` から自動探索する。
  （npm版 `@openai/codex` は `exec` で画像がファイル保存されないため不可。）

## 使い方（Git Bash 推奨）
```bash
cd "C:/Users/aoe10/Politica/POLITICAゲーム/画像生成"

# 盤面用イデオロギー紋章 5枚
./画像生成_codex実行.sh プロンプト_イデオロギー.csv 盤面画像

# 政治家ポートレート（まず10枚だけ試す）
./画像生成_codex実行.sh プロンプト_政治家.csv カード画像 10

# 全部
./画像生成_codex実行.sh プロンプト_政治家.csv カード画像
./画像生成_codex実行.sh プロンプト_チャンス.csv カード画像
./画像生成_codex実行.sh プロンプト_インシデント.csv カード画像
./画像生成_codex実行.sh プロンプト_法案.csv カード画像
```
- 既に生成済みのファイルはスキップ（再開可能）。
- `</dev/null` をスクリプト内で付与済み（while-readループで codex が CSV を食って止まる問題の対策）。

## 出力先とファイル名
- 紋章: `盤面画像/ideo_<cap|mil|com|sci|env>.png`
- 政治家: `カード画像/pol_pN.png` / チャンス: `chance_cN.png` /
  インシデント: `incident_iN.png` / 法案: `law_lN.png`
  （N は data.js のカードidと一致）

## ゲームへの反映
1. 上記で `画像生成/盤面画像/` `画像生成/カード画像/` に高解像PNGを生成。
2. `python assets最適化.py` を実行 → Web用に最大512pxへ縮小して `assets/board/` `assets/cards/`(ASCIIパス)へ出力。
3. ゲーム（ui.js）は `assets/` を読み込み、無いカードは絵文字/テキストにフォールバックする。

※ ゲームが実際に読むのは `assets/`。GitHub Pages配信での日本語パス回避と読み込み高速化のため、
   高解像の元画像(`画像生成/盤面画像`等)はリポジトリに含めない設定(.gitignore)。元画像はcodexで再生成可能。

## プロンプトCSVの作り直し
カード追加・文言調整時は、抽出スクリプトを再実行して CSV を再生成する
（`scratchpad/gen_cards.py` → `gen_prompts.py`）。
スタイル文言は `gen_prompts.py` の `STYLE` 定数を編集する。
