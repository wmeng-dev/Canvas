#!/bin/bash
# 生成带美化布局的 macOS DMG（背景图 + 图标摆位 + Applications 箭头）。
# 用法：bash scripts/make-dmg-beautified.sh
# 说明：需要本机有 GUI；osascript 首次会弹「控制 Finder」授权，点允许。结果输出到 release/。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/release/mac/风衍 IdeaSprout.app"
BG="$ROOT/release/background.jpg"
STAGE=/tmp/dmgstage
VOL=/Volumes/风衍\ IdeaSprout
OUT="$ROOT/release/IdeaSprout-0.1.0-mac-x64.dmg"

# 前置校验：缺文件直接提示，别让脚本半路不明不白地挂
if [ ! -d "$APP" ]; then echo "找不到应用包：$APP"; exit 1; fi
if [ ! -f "$BG" ]; then echo "找不到背景图：$BG"; exit 1; fi

# 清掉上次残留挂载（否则 -ov 覆盖 RDRW 模板或重建挂载点会报"资源忙"）
hdiutil detach -force /tmp/dmgmount 2>/dev/null || true
if [ -d "$VOL" ]; then hdiutil detach -force "$VOL" 2>/dev/null || true; fi

rm -rf "$STAGE"; mkdir -p "$STAGE/.background"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp "$BG" "$STAGE/.background/"

rm -f "$OUT" t.dmg
hdiutil create -volname "风衍 IdeaSprout" -srcfolder "$STAGE" -format UDRW -ov "$OUT"

# 显式挂载点 /tmp/dmgmount：挂载路径固定，无需解析 attach 输出（现代 macOS 默认是 APFS 卷，
# 不能按 Apple_HFS 去 grep）。只检查 attach 是否成功即可。
MOUNTDIR=/tmp/dmgmount
rm -rf "$MOUNTDIR"; mkdir -p "$MOUNTDIR"
if ! hdiutil attach -readwrite -nobrowse -mountpoint "$MOUNTDIR" "$OUT"; then
  echo "挂载失败（多半是上一次未 detach 或卷名被占用）"; exit 1
fi
MOUNT="$MOUNTDIR"
VOL="$MOUNT"

VOLNAME="风衍 IdeaSprout"
osascript - "$VOLNAME" <<'AS' || { hdiutil detach -force "$MOUNT"; echo "布局失败（osascript 未返回 0）"; exit 1; }
on run argv
    set theVol to item 1 of argv
    tell application "Finder"
        try
            open disk theVol
            tell disk theVol
                open
                set current view of container window to icon view
                set toolbar visible of container window to false
                set statusbar visible of container window to false
                set the bounds of container window to {400, 100, 2960, 1540}
                set theViewOptions to the icon view options of container window
                set arrangement of theViewOptions to not arranged
                set icon size of theViewOptions to 140
                set background picture of theViewOptions to file ".background:background.jpg"
                set position of item "风衍 IdeaSprout.app" of container window to {750, 680}
                set position of item "Applications" of container window to {1950, 680}
                update without registering applications
                delay 3
                close
            end tell
        end try
    end tell
end run
AS

hdiutil detach -force "$MOUNT"
hdiutil convert "$OUT" -format UDZO -o t.dmg && mv t.dmg "$OUT"
rm -rf "$STAGE"
echo "OK: $OUT"