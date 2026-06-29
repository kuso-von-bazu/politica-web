#!/usr/bin/env bash
# POLITICA カード/紋章 画像をデスクトップ版 Codex の image_gen で自動生成する。
# 使い方:  ./画像生成_codex実行.sh <プロンプトCSV> <出力サブフォルダ> [上限枚数]
#   例:    ./画像生成_codex実行.sh プロンプト_イデオロギー.csv 盤面画像
#          ./画像生成_codex実行.sh プロンプト_政治家.csv カード画像 10
#
# CSV形式:  1行目ヘッダ(ファイル名,内容) / 2行目以降 = ファイル名,プロンプト
# 前提:     codex login 済み。デスクトップ版 codex.exe を使う(npm版は exec で画像が保存されない)。
# 落とし穴: while-read ループ内で codex が stdin(CSV) を消費して2件目で止まる → </dev/null 必須。
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CSV="${1:?プロンプトCSVを指定してください}"
SUBDIR="${2:?出力サブフォルダ(カード画像 / 盤面画像 等)を指定してください}"
LIMIT="${3:-0}"   # 0=全件

# CSVは相対なら画像生成フォルダ基準
[ -f "$CSV" ] || CSV="$HERE/$CSV"
OUTDIR="$HERE/$SUBDIR"
mkdir -p "$OUTDIR"

# デスクトップ版 codex.exe を自動探索 (bin配下のハッシュ名フォルダ)
CODEX="$(ls -1 "$HOME/AppData/Local/OpenAI/Codex/bin/"*/codex.exe 2>/dev/null | head -1)"
if [ -z "$CODEX" ]; then
  echo "codex.exe が見つかりません。OpenAI Codex デスクトップ版をインストール/ログインしてください。" >&2
  exit 1
fi
echo "使用 codex: $CODEX"
echo "出力先   : $OUTDIR"

n=0; ok=0
# 1行目(ヘッダ)を読み飛ばす
{
  read -r _header
  while IFS=, read -r fname prompt; do
    [ -z "${fname:-}" ] && continue
    if [ "$LIMIT" -gt 0 ] && [ "$n" -ge "$LIMIT" ]; then break; fi
    n=$((n+1))
    out="$OUTDIR/$fname"
    if [ -f "$out" ]; then echo "[$n] skip(既存): $fname"; ok=$((ok+1)); continue; fi
    # Windowsパスへ変換
    winout="$(cygpath -w "$out" 2>/dev/null || echo "$out")"
    echo "[$n] 生成: $fname"
    "$CODEX" exec --dangerously-bypass-approvals-and-sandbox --cd "$OUTDIR" \
      "APIキーやスクリプトは書かず、組み込みの image_gen ツールを直接使って次の画像を生成し、生成した画像を $winout に保存してください。: ${prompt}" \
      </dev/null >/dev/null 2>&1
    if [ -f "$out" ]; then echo "    OK -> $fname"; ok=$((ok+1)); else echo "    失敗: $fname" >&2; fi
  done
} < "$CSV"

echo "完了: $ok / $n 枚"
