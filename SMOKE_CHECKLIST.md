# Focused Interaction Smoke Checklist

Use this checklist after UI/interaction changes to quickly validate the live surveillance experience.

## 1) Build + Boot

- [ ] `npm run build` succeeds with no errors.
- [ ] `npm run dev` starts and serves locally.
- [ ] App loads with globe, left/right panels, and bottom live status bar visible.

## 2) Search Keyboard Navigation

- [ ] Click search input and type a term like `gulf`.
- [ ] Results appear in grouped sections (`Operational Matches`, `Geographic Matches`).
- [ ] `ArrowDown` moves selection to next result.
- [ ] `ArrowUp` moves selection to previous result.
- [ ] `Enter` on selected result flies camera and applies regional context.
- [ ] `Escape` closes results and clears active cursor state.

Expected outcome:
- Search remains responsive; selected row highlight tracks keyboard cursor correctly.

## 3) Trust Indicators (Data Assurance)

- [ ] In `Controls` panel, confirm `Data Assurance` section renders all trust pills.
- [ ] Verify pills include: `ADS-B`, `AIS`, `UTC Sync`, and `Refresh`.
- [ ] Click `Refresh Feeds` and confirm trust state updates after refresh completes.
- [ ] Change refresh interval slider and verify refresh pill value updates.

Expected outcome:
- Trust summary text reflects confidence (`High`/`Moderate`/`Limited`) based on live source state.

## 4) Operational Legend Sync

- [ ] Confirm legend panel (`Operational Legend`) is visible.
- [ ] Toggle any layer in `Traffic Layers`.
- [ ] Verify corresponding legend item flips `ON/OFF` and inactive row dims.
- [ ] Trigger a live feed refresh and confirm legend timestamp (`UTC`) updates.

Expected outcome:
- Legend always mirrors current layer state and updates without page reload.

## 5) Regression Sweep (Fast)

- [ ] Select a track on the globe; ensure entity card updates.
- [ ] Open/close intel sheet from selection.
- [ ] Confirm no console-breaking UI freeze after multiple refresh/search actions.

## Quick Run Commands

```bash
npm run build
npm run dev
```
