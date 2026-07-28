# Tidefall First Mate

Tidefall First Mate is a Tampermonkey userscript for [Tidefall](https://www.playtidefall.com/) that adds quality-of-life tools, combat warnings, activity tracking, ship information, and configurable camera behavior.

## Features

### Combat tools

* PvE session tracker for kills, XP gained, kills to next Gunnery level, and net gold after tracked consumable costs
* Combat warnings for low hull, crew, ammo, food, and repair kits
* Click-to-dismiss warnings that rearm after the condition clears
* Hull and crew warning thresholds can use Percentage or Current / Max
* Cannon durability display with Percentage or Current / Max modes
* Cannon durability can be disabled

### Activity tools

* Activity session tracker with XP/hour, items/hour, level progress, and elapsed time
* Minimize and close controls
* Idle warning with configurable delay
* Idle warnings are suppressed during combat

### Display and camera

* Startup Zoom

  * Disabled by default
  * Nine fixed positions from 0% to 100%
  * 0% = fully zoomed in
  * 100% = fully zoomed out
  * Applied only during startup, then manual camera changes are left alone
* Startup Follow Ship

  * Can enable Follow Ship when Tidefall loads
  * Can re-enable Follow Ship when Navigation or a hauling delivery becomes active
* Refresh Tidefall button in First Mate's Settings

### Settings

All options are available from the **First Mate's Settings** tab in Tidefall's account/settings panel.

## Installation

1. Install a userscript manager such as Tampermonkey.https://www.tampermonkey.net/
2. Open `Tidefall\_First\_Mate\_1.0\_GitHub.user.js`.
3. Click "Raw" in the top right.
4. Click install.
5. Open or refresh Tidefall.

The script runs on:
```text
https://www.playtidefall.com/*
```

## Notes

* Tidefall First Mate is an unofficial community userscript.
* It is not affiliated with or endorsed by Tidefall.
* Some features depend on Tidefall's current page structure and may need updates if the game UI changes.
* Startup Zoom is disabled by default.

## License

No license has been selected yet.

