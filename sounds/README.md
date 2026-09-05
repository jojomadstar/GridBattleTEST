# 放真實音效檔的地方

合成音效做不出真正的鋼鐵撞擊與肉身打擊 —— 那需要錄音。
把音檔放進這個資料夾，檔名與音效名稱相同即可，程式會自動改用錄音，
沒有的就繼續用合成，不需要改任何程式碼。

支援 `.wav` / `.ogg` / `.mp3`（依此順序尋找）。

## 最值得優先替換的（影響最大）

| 檔名 | 內容 |
|---|---|
| `swordImpact.wav` | 刀劍砍中的金屬撞擊 |
| `swordSwing.wav` | 揮劍破空 |
| `punch.wav` | 拳頭打中身體的悶響 |
| `dragonBurst.wav` | 爆炸 |
| `hitHeavy.wav` | 通用重擊命中 |
| `hitLight.wav` | 通用輕擊命中 |
| `playerHurt.wav` | 玩家受擊 |
| `enemyCleave.wav` | 敵人重斬 |

## 全部可替換的名稱

dartThrow, nailThrow, machineBox, silkArmor, needleRain,
swordSwing, swordImpact, swordBeam, crossCut, thrust, counterStance, counterHit,
punch, palmPush, dragonPull, meridianLock, channelStart, channelTick, channelFinish,
dragonCharge, dragonBurst,
hitLight, hitHeavy, critAccent, launcher,
enemyShot, enemyTelegraph, teleport, enemyCleave, fieldOmen, tileBurst, dartVolley, counterBurst,
playerHurt, shieldBlock, drawCard, aimOn, aimOff, pause, victory, defeat

## 注意

- 檔案要修剪掉開頭的靜音，否則打擊會有延遲感
- 建議 44.1kHz，音量峰值正規化到 -3dB 左右
- **用 `file://` 直接開網頁時不會載入錄音**（瀏覽器 CORS 限制），
  要用本機伺服器，例如 `python3 -m http.server`
- 免費授權素材可在 freesound.org、Sonniss GDC bundle 等處取得，
  注意授權條款
