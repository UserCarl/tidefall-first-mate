// ==UserScript==
// @name         Tidefall First Mate
// @namespace    tidefall-carl-tools
// @version      1.0
// @description  Combat tracker, combat warnings, cannon durability, activity tracker, mastery-aware item rates, market pricing, and First Mate's Settings
// @match        https://www.playtidefall.com/*
// @updateURL    https://raw.githubusercontent.com/UserCarl/tidefall-first-mate/main/Tidefall_First_Mate.user.js
// @downloadURL  https://raw.githubusercontent.com/UserCarl/tidefall-first-mate/main/Tidefall_First_Mate.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // STORAGE
    // =========================================================

    const SETTINGS_STORAGE_KEY = 'tf-carl-settings-v2';
    const PRICE_STORAGE_KEY = 'tf-pve-market-prices-v2';
    const ACTIVITY_POSITION_KEY = 'tf-activity-panel-position-v1';
    const ACTIVITY_HISTORY_KEY = 'tf-activity-history-v1';

    const DEFAULT_SETTINGS = {
        combatTrackerEnabled: true,
        combatWarningsEnabled: true,

        hullWarningEnabled: true,
        hullWarningValue: 30,

        crewWarningEnabled: true,
        crewWarningValue: 30,

        ammoWarningEnabled: true,
        ammoWarningValue: 100,

        foodWarningEnabled: true,
        foodWarningValue: 0,

        repairWarningEnabled: true,
        repairWarningValue: 0,

        idleWarningEnabled: true,
        idleWarningSeconds: 30,

        activityTrackerEnabled: true,
        activityLevelMode: 'actions',

        cannonDurabilityEnabled: true,
        cannonDurabilityMode: 'percent',

        startupZoomEnabled: false,
        startupZoomPercent: 100,

        startupFollowShipEnabled: false
    };

    function loadSettings() {
        try {
            const oldSettings = JSON.parse(
                localStorage.getItem('tf-carl-settings-v1') || '{}'
            );

            const currentSettings = JSON.parse(
                localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'
            );

            return {
                ...DEFAULT_SETTINGS,
                ...oldSettings,
                ...currentSettings
            };
        } catch {
            return {
                ...DEFAULT_SETTINGS
            };
        }
    }

    let settings = loadSettings();

    function saveSettings() {
        try {
            localStorage.setItem(
                SETTINGS_STORAGE_KEY,
                JSON.stringify(settings)
            );
        } catch (error) {
            console.warn(
                '[Carl Tools] Could not save settings:',
                error
            );
        }
    }

    function updateSetting(key, value) {
        settings[key] = value;

        saveSettings();
        refreshSettingsUI();
        handleSettingsChanged();
    }

    // =========================================================
    // NATIVE TIDEFALL PANEL FRAME
    // =========================================================

    function addNativePanelFrame(panel) {
        if (
            !panel ||
            panel.querySelector(':scope > .rp-frame')
        ) {
            return;
        }

        const frame =
            document.createElement('div');

        frame.className =
            'rp-frame';

        frame.setAttribute(
            'aria-hidden',
            'true'
        );

        frame.innerHTML = `
            <div class="rp-edge rp-edge--top"></div>
            <div class="rp-edge rp-edge--bottom"></div>
        `;

        panel.prepend(frame);
    }

    // =========================================================
    // ACTIVITY HISTORY
    // =========================================================

    let activityHistory = {};

    try {
        activityHistory =
            JSON.parse(
                localStorage.getItem(
                    ACTIVITY_HISTORY_KEY
                ) || '{}'
            );
    } catch (error) {
        activityHistory = {};
    }

    function saveActivityHistory() {
        try {
            localStorage.setItem(
                ACTIVITY_HISTORY_KEY,
                JSON.stringify(
                    activityHistory
                )
            );
        } catch (error) {
            console.warn(
                '[Carl Tools] Could not save activity history:',
                error
            );
        }
    }

    function normalizeActivityKeyPart(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function buildActivityHistoryKey(
        panel,
        skill,
        taskName
    ) {
        const nodeElement =
            panel?.querySelector?.(
                '[data-node-id], [data-node], [data-activity-node-id]'
            );

        const nodeId =
            panel?.dataset?.nodeId ||
            panel?.dataset?.node ||
            panel?.dataset?.activityNodeId ||
            nodeElement?.dataset?.nodeId ||
            nodeElement?.dataset?.node ||
            nodeElement?.dataset?.activityNodeId ||
            '';

        if (nodeId) {
            return `node:${normalizeActivityKeyPart(nodeId)}`;
        }

        return (
            `task:${normalizeActivityKeyPart(skill)}:` +
            normalizeActivityKeyPart(taskName)
        );
    }

    function getActivityHistoryRecord(key) {
        if (!key) {
            return null;
        }

        const record =
            activityHistory[key];

        if (
            !record ||
            typeof record !== 'object'
        ) {
            return null;
        }

        return record;
    }

    // =========================================================
    // CONFIG
    // =========================================================

    const COMBAT_LEFT = 158;
    const COMBAT_TOP = 60;

    const ACTIVITY_RIGHT = 158;
    const ACTIVITY_TOP = 60;

    const COMBAT_SCAN_INTERVAL = 250;
    const ITEM_SCAN_INTERVAL = 250;
    const ITEM_DECREASE_CONFIRM_MS = 750;
    const MARKET_SCAN_INTERVAL = 750;
    const DISPLAY_INTERVAL = 1000;
    const WARNING_SCAN_INTERVAL = 250;
    const ACTIVITY_SCAN_INTERVAL = 250;

    const COMBAT_GRACE_PERIOD = 30000;

    /*
     * Activity estimates are established as soon
     * as enough data exists, then refreshed every
     * five minutes.
     */
    const ACTIVITY_ESTIMATE_REFRESH_MS =
        5 * 60 * 1000;

    // =========================================================
    // COMBAT ITEMS
    // =========================================================

    const ITEM_NAMES = {
        201: 'Copper Round Shot',
        202: 'Iron Round Shot',
        203: 'Cinder Round Shot',
        204: 'Darkiron Round Shot',
        205: 'Mithril Round Shot',
        206: 'Adamantite Round Shot',
        207: 'Starmetal Round Shot',
        208: 'Stormglass Round Shot',
        209: 'Leviathan Round Shot',
        210: 'Abyssal Round Shot',

        221: 'Salted Mackerel',
        222: 'Dried Sardines',
        223: 'Cod Stew',
        224: 'Grilled Salmon',
        225: 'Tuna Rations',
        226: 'Swordfish Cuts',
        227: 'Shark Haunch',
        228: 'Deepfin Steaks',
        229: 'Stormray Fillet',
        230: 'Dreadwhale Feast',

        231: 'Patch Kit',
        232: 'Caulking Kit',
        233: 'Hull Repair Kit',
        234: 'Deck Repair Kit',
        235: 'Reinforcement Kit',
        236: 'Shipwright Kit',
        237: 'Master Repair Kit',
        238: 'Hull Restoration Kit',
        239: 'Refit Crate',
        240: 'Master Refit Crate'
    };

    const AMMO_IDS = new Set([
        201, 202, 203, 204, 205,
        206, 207, 208, 209, 210
    ]);

    const FOOD_IDS = new Set([
        221, 222, 223, 224, 225,
        226, 227, 228, 229, 230
    ]);

    const REPAIR_IDS = new Set([
        231, 232, 233, 234, 235,
        236, 237, 238, 239, 240
    ]);

    const TRACKED_IDS = new Set(
        Object.keys(ITEM_NAMES).map(Number)
    );

    // =========================================================
    // GENERAL HELPERS
    // =========================================================

    function numberFromText(text) {
        if (!text) {
            return 0;
        }

        const normalized =
            String(text)
                .trim()
                .replace(/,/g, '');

        const abbreviated =
            normalized.match(
                /([+-]?\d*\.?\d+)\s*([kmb])\b/i
            );

        if (abbreviated) {
            const value =
                Number(abbreviated[1]);

            const suffix =
                abbreviated[2].toLowerCase();

            const multiplier =
                suffix === 'k'
                    ? 1_000
                    : suffix === 'm'
                        ? 1_000_000
                        : 1_000_000_000;

            return Number.isFinite(value)
                ? Math.round(value * multiplier)
                : 0;
        }

        const match =
            normalized.match(
                /[+-]?\d+(?:\.\d+)?/
            );

        if (!match) {
            return 0;
        }

        const value =
            Number(match[0]);

        return Number.isFinite(value)
            ? Math.round(value)
            : 0;
    }

    function decimalFromText(text) {
        if (!text) {
            return 0;
        }

        const value =
            parseFloat(
                String(text)
                    .replace(/,/g, '')
                    .replace(/[^\d.]/g, '')
            );

        return Number.isFinite(value)
            ? value
            : 0;
    }

    function formatDuration(seconds) {
        if (
            !Number.isFinite(seconds) ||
            seconds < 0
        ) {
            return '—';
        }

        seconds =
            Math.round(seconds);

        const hours =
            Math.floor(
                seconds / 3600
            );

        const minutes =
            Math.floor(
                (seconds % 3600) /
                60
            );

        const secs =
            seconds % 60;

        if (hours > 0) {
            return (
                `${hours}h ` +
                `${String(minutes).padStart(2, '0')}m ` +
                `${String(secs).padStart(2, '0')}s`
            );
        }

        return (
            `${minutes}m ` +
            `${String(secs).padStart(2, '0')}s`
        );
    }

    function titleCaseSkill(skill) {
        if (!skill) {
            return 'Activity';
        }

        return skill
            .replace(/[_-]/g, ' ')
            .replace(
                /\b\w/g,
                character =>
                    character.toUpperCase()
            );
    }

    // =========================================================
    // STYLES
    // =========================================================

    const style =
        document.createElement('style');

    style.textContent = `

        .tf-session-panel {
            position: fixed;

            z-index:
                var(--z-system-critical, 999999);

            width: 270px;

            background: rgba(30, 34, 36, 0.97);

            color:
                var(--text-primary, #e8e0d0);

            border: 1px solid rgba(197, 160, 89, 0.62);

            border-radius:
                var(--radius-md, .545rem);

            box-shadow:
                var(--shadow-md, 0 4px 12px #00000080),
                var(--shadow-glow-gold, 0 0 12px #c5a05926);

            font-family:
                var(--font-body, "Gothic A1", sans-serif);

            font-size:
                var(--font-size-base, 1rem);

            overflow: hidden;

            user-select: none;
        }


        .tf-session-panel > .rp-frame {
            pointer-events: none;
        }

        /* v8.9: Tidefall-style aged-gold session frame */
        .tf-session-panel > .rp-frame {
            position: absolute;
            inset: 5px;
            z-index: 0;
            pointer-events: none;
            border: 1px solid rgba(197, 160, 89, 0.38);
            box-shadow:
                inset 0 0 0 1px rgba(0, 0, 0, 0.55),
                inset 0 0 18px rgba(0, 0, 0, 0.24);
        }

        .tf-session-panel > .rp-frame::before,
        .tf-session-panel > .rp-frame::after {
            content: "";
            position: absolute;
            width: 20px;
            height: 20px;
            border-color: rgba(214, 176, 96, 0.82);
            pointer-events: none;
        }

        .tf-session-panel > .rp-frame::before {
            left: -1px;
            top: -1px;
            border-left: 2px solid rgba(214, 176, 96, 0.82);
            border-top: 2px solid rgba(214, 176, 96, 0.82);
            box-shadow: 3px 3px 0 -2px rgba(214, 176, 96, 0.42);
        }

        .tf-session-panel > .rp-frame::after {
            right: -1px;
            bottom: -1px;
            border-right: 2px solid rgba(214, 176, 96, 0.82);
            border-bottom: 2px solid rgba(214, 176, 96, 0.82);
            box-shadow: -3px -3px 0 -2px rgba(214, 176, 96, 0.42);
        }

        .tf-session-panel > .rp-frame > .rp-edge {
            position: absolute;
            left: 22px;
            right: 22px;
            height: 1px;
            background: linear-gradient(
                90deg,
                transparent,
                rgba(197, 160, 89, 0.55) 12%,
                rgba(214, 176, 96, 0.78) 50%,
                rgba(197, 160, 89, 0.55) 88%,
                transparent
            );
            opacity: 0.72;
        }

        .tf-session-panel > .rp-frame > .rp-edge--top {
            top: -1px;
        }

        .tf-session-panel > .rp-frame > .rp-edge--bottom {
            bottom: -1px;
        }

        .tf-session-panel > *:not(.rp-frame) {
            position: relative;
            z-index: 1;
        }

        .tf-session-header {
            display: flex;
            align-items: center;
            gap: 8px;

            padding: 10px 12px;

            background: linear-gradient(180deg, rgba(24, 25, 25, 0.97) 0%, rgba(7, 7, 13, 0.97) 100%);

            border-bottom:
                1px solid #c5a05933;

            cursor: move;
        }

        .tf-session-title {
            flex: 1;

            font-family:
                var(--font-heading, "QuadraatOffcPro", Georgia, serif);

            font-size:
                var(--font-size-lg, 1.3rem);

            font-weight: 600;

            letter-spacing: .10em;
            text-transform: uppercase;

            color:
                var(--gold, #c5a059);
        }

        .tf-window-btn {
            width: 26px;
            height: 26px;

            display: flex;
            align-items: center;
            justify-content: center;

            padding: 0;

            cursor: pointer;

            color: #ffffff73;
            background: #ffffff0a;

            border:
                1px solid #ffffff1a;

            border-radius: 50%;

            font-family:
                Arial,
                sans-serif;

            font-size: 16px;
            line-height: 1;
        }

        .tf-window-btn:hover {
            color:
                var(--gold, #c5a059);

            background:
                #ffffff17;

            border-color:
                #c5a05959;
        }

        .tf-session-body {
            padding: 14px 16px 16px;
        }

        .tf-stat-row {
            display: grid;

            grid-template-columns:
                1fr auto;

            align-items: baseline;

            gap: 12px;

            padding: 6px 0;

            border-bottom:
                1px solid #ffffff0d;
        }

        .tf-stat-label {
            color:
                var(--text-secondary, #d4be8ca6);

            font-size:
                var(--font-size-sm, .909rem);

            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tf-stat-value {
            color:
                var(--text-primary, #e8e0d0);

            font-size:
                var(--font-size-md, 1.1rem);

            font-weight: 600;

            text-align: right;
        }

        .tf-reset-row {
            display: flex;

            margin-top: 14px;
        }

        .tf-reset-button {
            width: 100%;

            padding: 8px 10px;

            cursor: pointer;

            font-family:
                var(--font-body);

            font-size:
                var(--font-size-sm);

            font-weight: 700;

            letter-spacing: .08em;
            text-transform: uppercase;

            color:
                var(--gold, #c5a059);

            background:
                #c5a05914;

            border:
                1px solid #c5a05959;

            border-radius:
                var(--radius-sm);
        }

        .tf-reset-button:hover {
            background:
                #c5a0592e;

            border-color:
                #c5a05999;
        }

        .tf-carl-refresh-button {
            width: 100%;

            padding: 10px 12px;

            cursor: pointer;

            font-family:
                var(--font-body);

            font-size:
                var(--font-size-sm);

            font-weight: 700;

            letter-spacing: .08em;
            text-transform: uppercase;

            color:
                var(--gold, #c5a059);

            background:
                #c5a05914;

            border:
                1px solid #c5a05959;

            border-radius:
                var(--radius-sm);
        }

        .tf-carl-refresh-button:hover {
            background:
                #c5a0592e;

            border-color:
                #c5a05999;
        }


        #tf-pve-panel {
            top: ${COMBAT_TOP}px;
            left: ${COMBAT_LEFT}px;
        }

        #tf-kills {
            color:
                var(--combat-victory, #e0c36a);
        }

        #tf-xp-gained,
        #tf-kills-to-level {
            color:
                var(--reward-xp, #aee67a);
        }

        #tf-net-gold {
            color:
                var(--reward-gold, #f0c45c);
        }

        #tf-pve-controls {
            display: flex;
            gap: 8px;

            margin-top: 14px;
        }

        #tf-pve-controls button {
            flex: 1;
        }

        #tf-start-stop {
            padding: 8px 10px;

            cursor: pointer;

            font-family:
                var(--font-body);

            font-size:
                var(--font-size-sm);

            font-weight: 700;

            letter-spacing: .08em;
            text-transform: uppercase;

            color: #1a1200;

            background:
                linear-gradient(
                    135deg,
                    #c5a059e6,
                    #dcb464f2
                );

            border:
                1px solid transparent;

            border-radius:
                var(--radius-sm);
        }

        #tf-start-stop.tf-stop {
            color:
                var(--text-danger, #d25a50cc);

            background:
                #d25a500f;

            border-color:
                #d25a504d;
        }

        #tf-status {
            margin-top: 10px;

            color:
                var(--text-muted, #ffffff4d);

            font-size:
                var(--font-size-xs, .818rem);

            text-align: center;
        }

        #tf-activity-panel {
            top: ${ACTIVITY_TOP}px;
            right: ${ACTIVITY_RIGHT}px;
        }

        #tf-activity-xp-hour,
        #tf-activity-level-value {
            color:
                var(--reward-xp, #aee67a);
        }

        #tf-activity-items-hour {
            color:
                var(--combat-victory, #e0c36a);
        }

        #tf-activity-skill {
            margin-top: 10px;

            color:
                var(--text-muted, #ffffff4d);

            font-size:
                var(--font-size-xs, .818rem);

            text-align: center;
        }

        #tf-price-warning {
            position: fixed;

            top: 120px;
            left: 50%;

            transform:
                translateX(-50%);

            z-index: 9999999;

            display: none;

            min-width: 420px;
            max-width: 80vw;

            padding: 16px 28px;

            text-align: center;

            background:
                rgba(5, 7, 10, .96);

            border:
                2px solid #d25a50;

            border-radius:
                var(--radius-md);

            pointer-events: none;
        }

        #tf-price-warning-title {
            font-family:
                var(--font-heading);

            font-size:
                var(--font-size-2xl);

            font-weight: 700;

            letter-spacing: .10em;
            text-transform: uppercase;

            color: #e86b60;
        }

        #tf-price-warning-message {
            margin-top: 5px;
        }


        #tf-idle-warning {
            position: fixed;

            top: 80px;
            left: 50%;

            transform:
                translateX(-50%);

            z-index: 9999999;

            display: none;

            min-width: 360px;
            max-width: 80vw;

            padding: 14px 28px;

            text-align: center;

            font-family:
                var(--font-heading);

            font-size:
                var(--font-size-2xl);

            font-weight: 900;

            letter-spacing: .08em;
            text-transform: uppercase;

            color: #ff3b30;

            background:
                rgba(5, 7, 10, .97);

            border:
                3px solid #ff3b30;

            border-radius:
                var(--radius-md);

            box-shadow:
                0 0 28px
                rgba(255, 59, 48, .35);

            pointer-events: auto;
            cursor: pointer;
        }

        #tf-combat-warning {
            position: fixed;

            top: 80px;
            left: 50%;

            transform:
                translateX(-50%);

            z-index: 9999999;

            display: none;

            min-width: 360px;
            max-width: 80vw;

            padding: 14px 28px;

            text-align: center;

            font-family:
                var(--font-heading);

            font-size:
                var(--font-size-2xl);

            font-weight: 900;

            letter-spacing: .08em;
            text-transform: uppercase;

            color: #ff3b30;

            background:
                rgba(5, 7, 10, .94);

            border:
                3px solid #ff3b30;

            border-radius:
                var(--radius-md);

            box-shadow:
                0 0 28px
                rgba(255, 59, 48, .35);

            pointer-events: auto;
            cursor: pointer;
        }

        .tf-cannon-durability {
            position: absolute;
            left: 2px;
            right: 2px;
            bottom: 2px;
            transform: translateY(4px);
            z-index: 3;
            padding: 1px 2px;
            color: var(--text-primary, #e8e0d0);
            background: rgba(5, 7, 10, .78);
            border-radius: 3px;
            font-size: 10px;
            font-weight: 800;
            line-height: 1.15;
            text-align: center;
            pointer-events: none;
        }

        .tf-cannon-durability.tf-cannon-durability--good {
            color: #aee67a;
        }

        .tf-cannon-durability.tf-cannon-durability--warn {
            color: #f0c45c;
        }

        .tf-cannon-durability.tf-cannon-durability--low {
            color: #e86b60;
        }

        .sp-hold-slot.ph-lo-slot[data-slot][data-itemtype] {
            position: relative;
        }

        body.tf-cannon-durability-scanning #inv-cargo-detail-modal {
            opacity: 0 !important;
            pointer-events: none !important;
        }

        .tf-carl-settings-group {
            margin-bottom: 22px;
        }

        .tf-carl-settings-group:last-child {
            margin-bottom: 0;
        }

        .tf-carl-settings-group-title {
            margin: 4px 0 10px;
            padding: 0 2px 8px;

            color:
                var(--gold, #c5a059);

            border-bottom:
                1px solid #c5a05933;

            font-family:
                var(--font-heading, "QuadraatOffcPro", Georgia, serif);

            font-size:
                var(--font-size-lg, 1.3rem);

            font-weight: 700;

            letter-spacing: .10em;
            text-transform: uppercase;
        }

        #tf-carl-settings-section {
            width: 100%;
        }

        .tf-carl-native-hidden {
            display: none !important;
        }

        .tf-carl-toggle-row,
        .tf-carl-threshold-row,
        .tf-carl-select-row {
            display: flex;

            align-items: center;
            justify-content: space-between;

            gap: 20px;

            width: 100%;
        }

        .tf-carl-threshold-row,
        .tf-carl-select-row {
            margin-top: 12px;
        }

        .tf-carl-setting-label {
            color:
                var(--text-primary);
        }

        .tf-carl-toggle {
            position: relative;

            width: 46px;
            height: 24px;

            flex-shrink: 0;

            cursor: pointer;

            border:
                1px solid #ffffff26;

            border-radius: 20px;

            background:
                #ffffff14;
        }

        .tf-carl-toggle::after {
            content: "";

            position: absolute;

            width: 18px;
            height: 18px;

            top: 2px;
            left: 3px;

            border-radius: 50%;

            background:
                #ffffff8c;

            transition:
                left .15s,
                background .15s;
        }

        .tf-carl-toggle.tf-enabled {
            background:
                #c5a05933;

            border-color:
                #c5a05999;
        }

        .tf-carl-toggle.tf-enabled::after {
            left: 23px;

            background:
                var(--gold);
        }

        .tf-carl-number-wrap {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .tf-carl-slider-wrap {
            display: grid;
            grid-template-columns: 220px 52px;
            align-items: center;
            column-gap: 10px;
            min-width: 282px;
        }

        .tf-carl-slider {
            width: 220px;
            cursor: pointer;
        }

        .tf-carl-slider-value {
            min-width: 52px;
            color: var(--text-primary);
            font-weight: 700;
            text-align: right;
        }

        .tf-carl-number,
        .tf-carl-select {
            box-sizing: border-box;

            padding: 8px 10px;

            color:
                var(--text-primary);

            background:
                #0000004d;

            border:
                1px solid #ffffff1a;

            border-radius:
                var(--radius-sm);

            font-family:
                var(--font-body);

            font-size:
                var(--font-size-base);
        }

        .tf-carl-number {
            width: 82px;

            text-align: right;
        }

        .tf-carl-select {
            min-width: 180px;

            cursor: pointer;
        }

        .tf-carl-number:focus,
        .tf-carl-select:focus {
            outline: none;

            border-color:
                #c5a05999;
        }

        .tf-carl-unit {
            min-width: 42px;

            color:
                var(--text-secondary);
        }

        .tf-carl-disabled {
            opacity: .35;

            pointer-events: none;
        }

        .tf-carl-card-dependent-disabled {
            opacity: .35;
        }
    `;

    document.head.appendChild(style);

    // =========================================================
    // WARNING ELEMENTS
    // =========================================================

    const idleWarning =
        document.createElement('div');

    idleWarning.id =
        'tf-idle-warning';

    idleWarning.textContent =
        'YOU ARE IDLE';

    document.body.appendChild(
        idleWarning
    );

    const combatWarning =
        document.createElement('div');

    combatWarning.id =
        'tf-combat-warning';

    document.body.appendChild(
        combatWarning
    );

    const priceWarning =
        document.createElement('div');

    priceWarning.id =
        'tf-price-warning';

    priceWarning.innerHTML = `
        <div id="tf-price-warning-title">
            PRICE MISSING
        </div>

        <div id="tf-price-warning-message">
            Open Exchange to load item price
        </div>
    `;

    document.body.appendChild(
        priceWarning
    );

    const priceWarningMessage =
        priceWarning.querySelector(
            '#tf-price-warning-message'
        );

    const dismissedCombatWarnings =
        new Set();

    let idleWarningDismissed =
        false;

    let currentCombatWarnings =
        [];

    idleWarning.addEventListener(
        'click',
        () => {
            if (
                idleWarning.style.display !==
                'none'
            ) {
                idleWarningDismissed =
                    true;

                idleWarning.style.display =
                    'none';
            }
        }
    );

    combatWarning.addEventListener(
        'click',
        () => {
            currentCombatWarnings.forEach(
                warning =>
                    dismissedCombatWarnings.add(
                        warning
                    )
            );

            combatWarning.style.display =
                'none';
        }
    );

    // =========================================================
    // COMBAT PANEL
    // =========================================================

    const combatPanel =
        document.createElement('div');

    combatPanel.id =
        'tf-pve-panel';

    combatPanel.className =
        'tf-session-panel';

    combatPanel.innerHTML = `
        <div
            id="tf-pve-header"
            class="tf-session-header"
        >
            <div class="tf-session-title">
                PvE Session
            </div>

            <button
                id="tf-minimize"
                class="tf-window-btn"
                type="button"
                title="Minimize"
            >
                −
            </button>

            <button
                id="tf-close"
                class="tf-window-btn"
                type="button"
                title="Close"
            >
                ×
            </button>
        </div>

        <div
            id="tf-pve-body"
            class="tf-session-body"
        >

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    Kills
                </span>

                <span
                    id="tf-kills"
                    class="tf-stat-value"
                >
                    0
                </span>
            </div>

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    XP Gained
                </span>

                <span
                    id="tf-xp-gained"
                    class="tf-stat-value"
                >
                    0
                </span>
            </div>

            <div class="tf-stat-row">
                <span
                    id="tf-kills-level-label"
                    class="tf-stat-label"
                >
                    Kills to Level
                </span>

                <span
                    id="tf-kills-to-level"
                    class="tf-stat-value"
                >
                    —
                </span>
            </div>

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    Net Gold
                </span>

                <span
                    id="tf-net-gold"
                    class="tf-stat-value"
                >
                    0
                </span>
            </div>

            <div id="tf-pve-controls">

                <button
                    id="tf-start-stop"
                    type="button"
                >
                    START
                </button>

                <button
                    id="tf-reset"
                    class="tf-reset-button"
                    type="button"
                >
                    RESET
                </button>

            </div>

            <div id="tf-status">
                Waiting for first kill...
            </div>

        </div>
    `;

    document.body.appendChild(
        combatPanel
    );

    combatPanel.style.display =
        'none';

    const combatHeader =
        combatPanel.querySelector(
            '#tf-pve-header'
        );

    const combatBody =
        combatPanel.querySelector(
            '#tf-pve-body'
        );

    const killsElement =
        combatPanel.querySelector(
            '#tf-kills'
        );

    const xpGainedElement =
        combatPanel.querySelector(
            '#tf-xp-gained'
        );

    const killsLevelLabel =
        combatPanel.querySelector(
            '#tf-kills-level-label'
        );

    const killsToLevelElement =
        combatPanel.querySelector(
            '#tf-kills-to-level'
        );

    const netGoldElement =
        combatPanel.querySelector(
            '#tf-net-gold'
        );

    const startStopButton =
        combatPanel.querySelector(
            '#tf-start-stop'
        );

    const combatResetButton =
        combatPanel.querySelector(
            '#tf-reset'
        );

    const combatMinimizeButton =
        combatPanel.querySelector(
            '#tf-minimize'
        );

    const combatCloseButton =
        combatPanel.querySelector(
            '#tf-close'
        );

    const combatStatusElement =
        combatPanel.querySelector(
            '#tf-status'
        );

    // =========================================================
    // ACTIVITY PANEL
    // =========================================================

    const activityPanel =
        document.createElement('div');

    activityPanel.id =
        'tf-activity-panel';

    activityPanel.className =
        'tf-session-panel';

    activityPanel.innerHTML = `
        <div
            id="tf-activity-header"
            class="tf-session-header"
        >
            <div class="tf-session-title">
                Activity Session
            </div>

            <button
                id="tf-activity-minimize"
                class="tf-window-btn"
                type="button"
                title="Minimize"
            >
                −
            </button>

            <button
                id="tf-activity-close"
                class="tf-window-btn"
                type="button"
                title="Close"
            >
                ×
            </button>
        </div>

        <div
            id="tf-activity-body"
            class="tf-session-body"
        >

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    XP / Hour
                </span>

                <span
                    id="tf-activity-xp-hour"
                    class="tf-stat-value"
                >
                    —
                </span>
            </div>

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    Items / Hour
                </span>

                <span
                    id="tf-activity-items-hour"
                    class="tf-stat-value"
                >
                    —
                </span>
            </div>

            <div class="tf-stat-row">
                <span
                    id="tf-activity-level-label"
                    class="tf-stat-label"
                >
                    Actions to Level
                </span>

                <span
                    id="tf-activity-level-value"
                    class="tf-stat-value"
                >
                    —
                </span>
            </div>

            <div class="tf-stat-row">
                <span class="tf-stat-label">
                    Elapsed
                </span>

                <span
                    id="tf-activity-elapsed"
                    class="tf-stat-value"
                >
                    0m 00s
                </span>
            </div>

            <div class="tf-reset-row">

                <button
                    id="tf-activity-reset"
                    class="tf-reset-button"
                    type="button"
                >
                    RESET
                </button>

            </div>

            <div id="tf-activity-skill">
                Waiting for activity...
            </div>

        </div>
    `;
    document.body.appendChild(
        activityPanel
    );

    activityPanel.style.display =
        'none';

    const activityHeader =
        activityPanel.querySelector(
            '#tf-activity-header'
        );

    const activityBody =
        activityPanel.querySelector(
            '#tf-activity-body'
        );

    const activityMinimizeButton =
        activityPanel.querySelector(
            '#tf-activity-minimize'
        );

    const activityXpHourElement =
        activityPanel.querySelector(
            '#tf-activity-xp-hour'
        );

    const activityItemsHourElement =
        activityPanel.querySelector(
            '#tf-activity-items-hour'
        );

    const activityLevelLabel =
        activityPanel.querySelector(
            '#tf-activity-level-label'
        );

    const activityLevelValue =
        activityPanel.querySelector(
            '#tf-activity-level-value'
        );

    const activityElapsedElement =
        activityPanel.querySelector(
            '#tf-activity-elapsed'
        );

    const activitySkillElement =
        activityPanel.querySelector(
            '#tf-activity-skill'
        );

    const activityResetButton =
        activityPanel.querySelector(
            '#tf-activity-reset'
        );

    const activityCloseButton =
        activityPanel.querySelector(
            '#tf-activity-close'
        );

    // =========================================================
    // COMBAT STATE
    // =========================================================

    let combatRunning = false;

    let combatKills = 0;
    let combatTotalXP = 0;
    let combatGrossGold = 0;

    let combatMinimized = false;

    const processedVictories =
        new Set();

    const lastQuantities =
        new Map();

    /*
     * Last warehouse quantities seen while the port
     * inventory is mounted in the DOM.
     *
     * We keep these cached when leaving port so the
     * combined ship + warehouse total remains stable.
     */
    const warehouseQuantities =
        new Map();

    /*
     * Potential decreases are confirmed briefly before
     * being charged. This prevents a normal warehouse
     * -> ship transfer from looking like item consumption
     * while the two DOM areas update a few milliseconds
     * apart.
     */
    const pendingItemDecreases =
        new Map();

    const consumedItems =
        new Map();

    const sessionPrices =
        new Map();

    // =========================================================
    // PRICE CACHE
    // =========================================================

    let priceCache = {};

    try {
        priceCache =
            JSON.parse(
                localStorage.getItem(
                    PRICE_STORAGE_KEY
                ) || '{}'
            );
    } catch {
        priceCache = {};
    }

    function savePriceCache() {
        try {
            localStorage.setItem(
                PRICE_STORAGE_KEY,
                JSON.stringify(
                    priceCache
                )
            );
        } catch {
            // Ignore.
        }
    }

    function setCachedPrice(
        itemId,
        price,
        source
    ) {
        if (
            !TRACKED_IDS.has(
                itemId
            )
        ) {
            return;
        }

        if (
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return;
        }

        const existing =
            priceCache[itemId];

        if (
            existing &&
            typeof existing ===
                'object' &&
            Number(existing.price) ===
                price &&
            existing.source ===
                source
        ) {
            return;
        }

        priceCache[itemId] = {
            price,
            source,
            updated: Date.now()
        };

        savePriceCache();
    }

    function getCachedPrice(itemId) {
        const cached =
            priceCache[itemId];

        if (
            typeof cached ===
            'number'
        ) {
            return cached;
        }

        if (
            cached &&
            typeof cached ===
                'object'
        ) {
            return (
                Number(cached.price) ||
                0
            );
        }

        return 0;
    }

    // =========================================================
    // COMBAT DETECTION
    // =========================================================

    let lastCombatTime = 0;

    function isActuallyInCombat() {
        const hud =
            document.querySelector(
                '#combat-ammo-hud'
            );

        if (!hud) {
            return false;
        }

        if (
            hud.classList.contains(
                'combat-ammo-hud--precombat'
            )
        ) {
            return false;
        }

        if (hud.hidden) {
            return false;
        }

        return true;
    }

    function isInCombat() {
        if (
            isActuallyInCombat()
        ) {
            lastCombatTime =
                Date.now();

            return true;
        }

        if (
            lastCombatTime > 0 &&
            Date.now() -
                lastCombatTime <=
                COMBAT_GRACE_PERIOD
        ) {
            return true;
        }

        return false;
    }

    // =========================================================
    // HULL / CREW
    // =========================================================

    function getHullPercent() {
        const element =
            document.querySelector(
                '#cs-hull-bar'
            );

        if (!element) {
            return null;
        }

        const value =
            parseFloat(
                element.dataset.pct
            );

        return Number.isFinite(value)
            ? value
            : null;
    }

    function getCrewPercent() {
        const element =
            document.querySelector(
                '#cs-crew-bar'
            );

        if (!element) {
            return null;
        }

        const value =
            parseFloat(
                element.dataset.pct
            );

        return Number.isFinite(value)
            ? value
            : null;
    }

    // =========================================================
    // COMBAT ITEMS
    // =========================================================

    function getEquippedConsumables() {
        const quantities =
            new Map();

        const container =
            document.querySelector(
                '#combat-ammo-hud-munitions'
            );

        if (!container) {
            return quantities;
        }

        container
            .querySelectorAll(
                '[data-item-id]'
            )
            .forEach(
                element => {

                    const itemId =
                        Number(
                            element.dataset
                                .itemId
                        );

                    if (
                        !TRACKED_IDS.has(
                            itemId
                        )
                    ) {
                        return;
                    }

                    let quantity =
                        null;

                    if (
                        element.dataset.qty !==
                            undefined &&
                        element.dataset.qty !==
                            ''
                    ) {
                        quantity =
                            Number(
                                element.dataset
                                    .qty
                            );
                    }

                    if (
                        quantity === null ||
                        Number.isNaN(
                            quantity
                        )
                    ) {
                        const badge =
                            element.querySelector(
                                '.mp-badge-count'
                            );

                        if (badge) {
                            quantity =
                                numberFromText(
                                    badge.textContent
                                );
                        }
                    }

                    if (
                        quantity !== null &&
                        !Number.isNaN(
                            quantity
                        )
                    ) {
                        quantities.set(
                            itemId,
                            quantity
                        );
                    }
                }
            );

        return quantities;
    }


    function scanWarehouseConsumables() {
        const seen =
            new Set();

        document
            .querySelectorAll(
                '[data-source="warehouse"][data-item-type]'
            )
            .forEach(
                element => {

                    const itemId =
                        Number(
                            element.dataset
                                .itemType
                        );

                    if (
                        !TRACKED_IDS.has(
                            itemId
                        )
                    ) {
                        return;
                    }

                    const badge =
                        element.querySelector(
                            '.mp-badge-count'
                        );

                    if (!badge) {
                        return;
                    }

                    const quantity =
                        numberFromText(
                            badge.textContent
                        );

                    warehouseQuantities.set(
                        itemId,
                        quantity
                    );

                    seen.add(
                        itemId
                    );
                }
            );

        /*
         * Only set unseen tracked items to zero when the
         * warehouse inventory itself is clearly mounted.
         * Otherwise keep the last known warehouse value.
         */
        const warehouseMounted =
            document.querySelector(
                '[data-source="warehouse"]'
            );

        if (warehouseMounted) {
            TRACKED_IDS.forEach(
                itemId => {
                    if (
                        !seen.has(itemId) &&
                        !warehouseQuantities.has(
                            itemId
                        )
                    ) {
                        warehouseQuantities.set(
                            itemId,
                            0
                        );
                    }
                }
            );
        }
    }

    function getCombinedTrackedQuantities() {
        scanWarehouseConsumables();

        const ship =
            getEquippedConsumables();

        const combined =
            new Map();

        TRACKED_IDS.forEach(
            itemId => {

                const shipQuantity =
                    ship.get(itemId) || 0;

                const warehouseQuantity =
                    warehouseQuantities.get(
                        itemId
                    ) || 0;

                combined.set(
                    itemId,
                    shipQuantity +
                    warehouseQuantity
                );
            }
        );

        return combined;
    }

    function getItemQuantityForIds(
        idSet
    ) {
        const container =
            document.querySelector(
                '#combat-ammo-hud-munitions'
            );

        if (!container) {
            return null;
        }

        const elements =
            container.querySelectorAll(
                '[data-item-id]'
            );

        for (
            const element
            of elements
        ) {
            const itemId =
                Number(
                    element.dataset
                        .itemId
                );

            if (
                !idSet.has(itemId)
            ) {
                continue;
            }

            if (
                element.dataset.qty !==
                    undefined &&
                element.dataset.qty !==
                    ''
            ) {
                const quantity =
                    Number(
                        element.dataset.qty
                    );

                if (
                    Number.isFinite(
                        quantity
                    )
                ) {
                    return quantity;
                }
            }

            const badge =
                element.querySelector(
                    '.mp-badge-count'
                );

            if (badge) {
                return numberFromText(
                    badge.textContent
                );
            }
        }

        return 0;
    }

    // =========================================================
    // IDLE WARNING
    // =========================================================

    let idleSince =
        null;

    let idleWasInCombat =
        false;

    function isTaskIdle() {
        const panel =
            document.querySelector(
                '#active-task-panel'
            );

        return Boolean(
            panel &&
            panel.dataset.state ===
                'idle'
        );
    }

    function checkIdleWarning() {
        if (
            !settings.idleWarningEnabled
        ) {
            idleSince = null;
            idleWasInCombat = false;
            idleWarningDismissed = false;
            idleWarning.style.display = 'none';
            return;
        }

        const inCombat =
            isActuallyInCombat();

        if (inCombat) {
            idleWasInCombat = true;
            idleSince = null;
            idleWarningDismissed = false;
            idleWarning.style.display = 'none';
            return;
        }

        if (idleWasInCombat) {
            idleWasInCombat = false;
            idleSince = Date.now();
            idleWarningDismissed = false;
            idleWarning.style.display = 'none';
            return;
        }

        if (!isTaskIdle()) {
            idleSince = null;
            idleWarningDismissed = false;
            idleWarning.style.display = 'none';
            return;
        }

        if (idleSince === null) {
            idleSince = Date.now();
            idleWarning.style.display = 'none';
            return;
        }

        const thresholdSeconds =
            Math.max(
                1,
                Number(settings.idleWarningSeconds) || 30
            );

        const idleSeconds =
            (Date.now() - idleSince) / 1000;

        if (
            idleSeconds >= thresholdSeconds &&
            !idleWarningDismissed
        ) {
            idleWarning.textContent =
                'YOU ARE IDLE';

            idleWarning.style.display =
                'block';
        } else {
            idleWarning.style.display =
                'none';
        }
    }

    // =========================================================
    // COMBAT WARNINGS
    // =========================================================

    function checkCombatWarnings() {
        if (
            !settings.combatWarningsEnabled ||
            !isInCombat()
        ) {
            currentCombatWarnings = [];
            dismissedCombatWarnings.clear();
            combatWarning.style.display = 'none';
            return;
        }

        const warnings = [];

        const hull =
            getHullPercent();

        const crew =
            getCrewPercent();

        if (
            settings.hullWarningEnabled &&
            hull !== null &&
            hull <= settings.hullWarningValue
        ) {
            warnings.push('LOW HULL');
        }

        if (
            settings.crewWarningEnabled &&
            crew !== null &&
            crew <= settings.crewWarningValue
        ) {
            warnings.push('LOW CREW');
        }

        if (
            settings.combatTrackerEnabled
        ) {
            const ammo =
                getItemQuantityForIds(
                    AMMO_IDS
                );

            const food =
                getItemQuantityForIds(
                    FOOD_IDS
                );

            const repairs =
                getItemQuantityForIds(
                    REPAIR_IDS
                );

            if (
                settings.ammoWarningEnabled &&
                ammo !== null &&
                ammo <= settings.ammoWarningValue
            ) {
                warnings.push('LOW AMMO');
            }

            if (
                settings.foodWarningEnabled &&
                food !== null &&
                food <= settings.foodWarningValue
            ) {
                warnings.push('LOW FOOD');
            }

            if (
                settings.repairWarningEnabled &&
                repairs !== null &&
                repairs <= settings.repairWarningValue
            ) {
                warnings.push('LOW REPAIR KITS');
            }
        }

        /*
         * A dismissed warning is rearmed as soon as its
         * condition clears. If that condition happens again
         * later, the warning will show again.
         */
        Array.from(
            dismissedCombatWarnings
        ).forEach(
            warning => {
                if (
                    !warnings.includes(
                        warning
                    )
                ) {
                    dismissedCombatWarnings.delete(
                        warning
                    );
                }
            }
        );

        currentCombatWarnings =
            warnings.slice();

        const visibleWarnings =
            warnings.filter(
                warning =>
                    !dismissedCombatWarnings.has(
                        warning
                    )
            );

        if (
            visibleWarnings.length === 0
        ) {
            combatWarning.style.display =
                'none';
            return;
        }

        combatWarning.innerHTML =
            visibleWarnings.join('<br>');

        combatWarning.style.display =
            'block';
    }

    // =========================================================
    // CANNON DURABILITY
    // =========================================================

    const CANNON_DURABILITY_SCAN_INTERVAL =
        30000;

    let cannonDurabilityScanning =
        false;

    let lastCannonLayoutSignature =
        '';

    function getCannonSlots() {
        return Array.from(
            document.querySelectorAll(
                '.sp-hold-slot.ph-lo-slot[data-slot][data-itemtype]'
            )
        ).filter(
            slot =>
                /^\d+$/.test(
                    String(slot.dataset.slot || '')
                )
        );
    }

    function getCannonLayoutSignature() {
        return getCannonSlots()
            .map(
                slot =>
                    [
                        slot.dataset.ship || '',
                        slot.dataset.slot || '',
                        slot.dataset.itemtype || ''
                    ].join(':')
            )
            .join('|');
    }

    function addCannonDurabilityText(
        slot,
        current,
        maximum
    ) {
        if (
            !settings.cannonDurabilityEnabled ||
            !slot ||
            !Number.isFinite(current) ||
            !Number.isFinite(maximum) ||
            maximum <= 0
        ) {
            return;
        }

        const percent =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        current / maximum * 100
                    )
                )
            );

        let label =
            slot.querySelector(
                ':scope > .tf-cannon-durability'
            );

        if (!label) {
            label =
                document.createElement('div');

            label.className =
                'tf-cannon-durability';

            slot.appendChild(label);
        }

        label.dataset.current =
            String(current);

        label.dataset.maximum =
            String(maximum);

        label.textContent =
            settings.cannonDurabilityMode ===
                'raw'
                ? `${current}/${maximum}`
                : `${percent}%`;

        label.title =
            `Cannon condition: ${current.toLocaleString()} / ${maximum.toLocaleString()}`;

        label.classList.remove(
            'tf-cannon-durability--good',
            'tf-cannon-durability--warn',
            'tf-cannon-durability--low'
        );

        label.classList.add(
            percent <= 25
                ? 'tf-cannon-durability--low'
                : percent <= 50
                    ? 'tf-cannon-durability--warn'
                    : 'tf-cannon-durability--good'
        );
    }

    function refreshCannonDurabilityDisplay() {
        const labels =
            document.querySelectorAll(
                '.tf-cannon-durability'
            );

        if (
            !settings.cannonDurabilityEnabled
        ) {
            labels.forEach(
                label => label.remove()
            );

            lastCannonLayoutSignature =
                '';

            return;
        }

        labels.forEach(
            label => {
                const current =
                    Number(
                        label.dataset.current
                    );

                const maximum =
                    Number(
                        label.dataset.maximum
                    );

                if (
                    Number.isFinite(current) &&
                    Number.isFinite(maximum) &&
                    maximum > 0
                ) {
                    const slot =
                        label.closest(
                            '.sp-hold-slot.ph-lo-slot[data-slot][data-itemtype]'
                        );

                    addCannonDurabilityText(
                        slot,
                        current,
                        maximum
                    );
                }
            }
        );

        if (
            labels.length === 0
        ) {
            setTimeout(
                () =>
                    scanCannonDurability(
                        true
                    ),
                100
            );
        }
    }

    function readConditionFromCannonModal() {
        const modal =
            document.querySelector(
                '#inv-cargo-detail-modal'
            );

        if (!modal) {
            return null;
        }

        const rows =
            Array.from(
                modal.querySelectorAll(
                    '.ms-item-stats__col'
                )
            );

        const conditionRow =
            rows.find(
                row =>
                    row.querySelector(
                        '.ms-item-stats__label'
                    )?.textContent
                        ?.trim()
                        ?.toLowerCase() ===
                    'condition'
            );

        const text =
            conditionRow?.querySelector(
                '.ms-item-stats__value'
            )?.textContent?.trim() || '';

        const match =
            text
                .replace(/,/g, '')
                .match(
                    /(\d+)\s*\/\s*(\d+)/
                );

        if (!match) {
            return null;
        }

        const current =
            Number(match[1]);

        const maximum =
            Number(match[2]);

        if (
            !Number.isFinite(current) ||
            !Number.isFinite(maximum) ||
            maximum <= 0
        ) {
            return null;
        }

        return {
            current,
            maximum
        };
    }

    function closeCannonDetailModal() {
        const modal =
            document.querySelector(
                '#inv-cargo-detail-modal'
            );

        if (!modal) {
            return;
        }

        const closeButton =
            modal.querySelector(
                '[aria-label="Close"], [title="Close"], .ms-close, .modal-close'
            );

        if (closeButton instanceof HTMLElement) {
            closeButton.click();
            return;
        }

        const backdrop =
            modal.querySelector(
                '.ms-backdrop'
            );

        if (backdrop instanceof HTMLElement) {
            backdrop.click();
            return;
        }

        document.dispatchEvent(
            new KeyboardEvent(
                'keydown',
                {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true
                }
            )
        );
    }

    function waitForCannonCondition(
        timeoutMs = 1200
    ) {
        return new Promise(
            resolve => {
                const started =
                    Date.now();

                const check =
                    () => {
                        const condition =
                            readConditionFromCannonModal();

                        if (condition) {
                            resolve(condition);
                            return;
                        }

                        if (
                            Date.now() - started >=
                            timeoutMs
                        ) {
                            resolve(null);
                            return;
                        }

                        setTimeout(check, 40);
                    };

                check();
            }
        );
    }

    async function scanCannonDurability(
        force = false
    ) {
        if (
            !settings.cannonDurabilityEnabled ||
            cannonDurabilityScanning ||
            isActuallyInCombat()
        ) {
            return;
        }

        const slots =
            getCannonSlots();

        if (slots.length === 0) {
            lastCannonLayoutSignature = '';
            return;
        }

        if (
            document.querySelector(
                '#inv-cargo-detail-modal'
            )
        ) {
            return;
        }

        const signature =
            getCannonLayoutSignature();

        if (
            !force &&
            signature &&
            signature === lastCannonLayoutSignature &&
            slots.every(
                slot =>
                    slot.querySelector(
                        ':scope > .tf-cannon-durability'
                    )
            )
        ) {
            return;
        }

        cannonDurabilityScanning =
            true;

        document.body.classList.add(
            'tf-cannon-durability-scanning'
        );

        try {
            const orderedSlots =
                slots.slice().sort(
                    (a, b) =>
                        Number(a.dataset.slot) -
                        Number(b.dataset.slot)
                );

            for (const slot of orderedSlots) {
                if (isActuallyInCombat()) {
                    break;
                }

                slot.click();

                const condition =
                    await waitForCannonCondition();

                if (condition) {
                    addCannonDurabilityText(
                        slot,
                        condition.current,
                        condition.maximum
                    );
                }

                closeCannonDetailModal();

                await new Promise(
                    resolve =>
                        setTimeout(resolve, 80)
                );
            }

            lastCannonLayoutSignature =
                getCannonLayoutSignature();
        } catch (error) {
            console.warn(
                '[Carl Tools] Cannon durability scan failed:',
                error
            );
        } finally {
            closeCannonDetailModal();

            document.body.classList.remove(
                'tf-cannon-durability-scanning'
            );

            cannonDurabilityScanning =
                false;
        }
    }

    function checkForNewCannonLayout() {
        if (
            !settings.cannonDurabilityEnabled ||
            cannonDurabilityScanning ||
            isActuallyInCombat()
        ) {
            return;
        }

        const signature =
            getCannonLayoutSignature();

        if (
            signature &&
            signature !== lastCannonLayoutSignature
        ) {
            setTimeout(
                () =>
                    scanCannonDurability(true),
                250
            );
        } else if (!signature) {
            lastCannonLayoutSignature = '';
        }
    }

    // =========================================================
    // SKILL HELPERS
    // =========================================================

    function getSkillCard(skill) {
        if (!skill) {
            return null;
        }

        try {
            return document.querySelector(
                `.pp-skill-card[data-skill="${CSS.escape(skill)}"]`
            );
        } catch {
            return document.querySelector(
                `.pp-skill-card[data-skill="${skill}"]`
            );
        }
    }

    function getSkillXP(skill) {
        const card =
            getSkillCard(skill);

        if (!card) {
            return null;
        }

        const xpElement =
            card.querySelector(
                '.pp-skill-xp'
            );

        const source =
            xpElement
                ? xpElement.textContent
                : card.textContent;

        const match =
            String(source)
                .replace(/,/g, '')
                .match(
                    /(\d+)\s*\/\s*(\d+)\s*XP/i
                );

        if (!match) {
            return null;
        }

        return {
            current:
                Number(match[1]),

            required:
                Number(match[2])
        };
    }

    function getSkillLevel(skill) {
        const card =
            getSkillCard(skill);

        if (!card) {
            return null;
        }

        const match =
            card.textContent
                .replace(/\s+/g, ' ')
                .match(
                    /\b(?:level|lvl|lv\.?)\s*:?\s*(\d+)\b/i
                );

        if (match) {
            return Number(
                match[1]
            );
        }

        return null;
    }

    // =========================================================
    // GUNNERY
    // =========================================================

    function getKillsToLevel() {
        if (
            combatKills <= 0 ||
            combatTotalXP <= 0
        ) {
            return null;
        }

        const gunnery =
            getSkillXP(
                'gunnery'
            );

        if (!gunnery) {
            return null;
        }

        const remaining =
            Math.max(
                0,
                gunnery.required -
                    gunnery.current
            );

        if (
            remaining <= 0
        ) {
            return 0;
        }

        const average =
            combatTotalXP /
            combatKills;

        return average > 0
            ? Math.ceil(
                remaining /
                average
            )
            : null;
    }

    // =========================================================
    // MARKET
    // =========================================================

    function getOpenExchangeItemId() {
        const breadcrumbs =
            document.querySelector(
                '.mkt-detail-crumbs'
            );

        if (!breadcrumbs) {
            return null;
        }

        const text =
            breadcrumbs.textContent
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

        for (
            const [id, name]
            of Object.entries(
                ITEM_NAMES
            )
        ) {
            if (
                text.includes(
                    name.toLowerCase()
                )
            ) {
                return Number(id);
            }
        }

        return null;
    }

    function getLastSoldPriceFromOpenItem() {
        const element =
            document.querySelector(
                '.mkt-detail-fills-rows .mkt-row .mkt-detail-order-price'
            );

        if (!element) {
            return null;
        }

        const price =
            decimalFromText(
                element.textContent
            );

        return price > 0
            ? price
            : null;
    }

    function scanMarketPrices() {
        document
            .querySelectorAll(
                'tr.mkt-row[data-mkt-item]'
            )
            .forEach(
                row => {

                    const itemId =
                        Number(
                            row.dataset
                                .mktItem
                        );

                    if (
                        !TRACKED_IDS.has(
                            itemId
                        )
                    ) {
                        return;
                    }

                    const element =
                        row.querySelector(
                            '.mkt-price-main'
                        );

                    if (!element) {
                        return;
                    }

                    const price =
                        decimalFromText(
                            element.textContent
                        );

                    if (price > 0) {
                        setCachedPrice(
                            itemId,
                            price,
                            'listing'
                        );
                    }
                }
            );

        const itemId =
            getOpenExchangeItemId();

        if (
            itemId !== null
        ) {
            const price =
                getLastSoldPriceFromOpenItem();

            if (
                price !== null
            ) {
                setCachedPrice(
                    itemId,
                    price,
                    'last-sale'
                );
            }
        }

        checkForMissingPrices();
    }

    // =========================================================
    // COMBAT CONSUMPTION
    // =========================================================

    function initializeItemTracking() {
        lastQuantities.clear();
        pendingItemDecreases.clear();

        getCombinedTrackedQuantities()
            .forEach(
                (
                    quantity,
                    itemId
                ) => {

                    lastQuantities.set(
                        itemId,
                        quantity
                    );

                    const price =
                        getCachedPrice(
                            itemId
                        );

                    if (
                        price > 0
                    ) {
                        sessionPrices.set(
                            itemId,
                            price
                        );
                    }
                }
            );
    }

    function scanItemConsumption() {
        if (
            !combatRunning ||
            !settings
                .combatTrackerEnabled
        ) {
            return;
        }

        const now =
            Date.now();

        const quantities =
            getCombinedTrackedQuantities();

        quantities.forEach(
            (
                quantity,
                itemId
            ) => {

                if (
                    !lastQuantities.has(
                        itemId
                    )
                ) {
                    lastQuantities.set(
                        itemId,
                        quantity
                    );

                    return;
                }

                const previous =
                    lastQuantities.get(
                        itemId
                    );

                /*
                 * If total inventory increased or returned
                 * to the previous value, this was likely a
                 * transfer/restock rather than consumption.
                 */
                if (
                    quantity >=
                    previous
                ) {
                    lastQuantities.set(
                        itemId,
                        quantity
                    );

                    pendingItemDecreases.delete(
                        itemId
                    );

                    return;
                }

                const decrease =
                    previous -
                    quantity;

                const pending =
                    pendingItemDecreases.get(
                        itemId
                    );

                if (
                    !pending ||
                    pending.quantity !==
                        quantity ||
                    pending.previous !==
                        previous
                ) {
                    pendingItemDecreases.set(
                        itemId,
                        {
                            previous,
                            quantity,
                            decrease,
                            since:
                                now
                        }
                    );

                    return;
                }

                if (
                    now -
                        pending.since <
                    ITEM_DECREASE_CONFIRM_MS
                ) {
                    return;
                }

                consumedItems.set(
                    itemId,
                    (
                        consumedItems.get(
                            itemId
                        ) || 0
                    ) +
                    decrease
                );

                const price =
                    getCachedPrice(
                        itemId
                    );

                if (
                    price > 0 &&
                    !sessionPrices.has(
                        itemId
                    )
                ) {
                    sessionPrices.set(
                        itemId,
                        price
                    );
                }

                lastQuantities.set(
                    itemId,
                    quantity
                );

                pendingItemDecreases.delete(
                    itemId
                );
            }
        );
    }

    function getConsumableCost() {
        let total = 0;

        consumedItems.forEach(
            (
                quantity,
                itemId
            ) => {

                const price =
                    sessionPrices.get(
                        itemId
                    ) ||
                    getCachedPrice(
                        itemId
                    ) ||
                    0;

                total +=
                    quantity *
                    price;
            }
        );

        return total;
    }

    function checkForMissingPrices() {
        if (
            !combatRunning ||
            !settings
                .combatTrackerEnabled ||
            !isInCombat()
        ) {
            priceWarning.style.display =
                'none';

            return;
        }

        const missing = [];

        getEquippedConsumables()
            .forEach(
                (
                    quantity,
                    itemId
                ) => {

                    if (
                        quantity > 0 &&
                        getCachedPrice(
                            itemId
                        ) <= 0
                    ) {
                        missing.push(
                            ITEM_NAMES[
                                itemId
                            ]
                        );
                    }
                }
            );

        if (
            missing.length === 0
        ) {
            priceWarning.style.display =
                'none';

            return;
        }

        priceWarningMessage.textContent =
            missing.join(', ');

        priceWarning.style.display =
            'block';
    }

    // =========================================================
    // COMBAT DISPLAY
    // =========================================================

    function updateCombatDisplay() {
        killsElement.textContent =
            combatKills.toLocaleString();

        xpGainedElement.textContent =
            combatTotalXP.toLocaleString();

        const level =
            getSkillLevel(
                'gunnery'
            );

        killsLevelLabel.textContent =
            level !== null
                ? `Kills to Level ${level + 1}`
                : 'Kills to Level';

        const killsRemaining =
            getKillsToLevel();

        killsToLevelElement.textContent =
            killsRemaining === null
                ? '—'
                : killsRemaining
                    .toLocaleString();

        const net =
            Math.round(
                combatGrossGold -
                getConsumableCost()
            );

        netGoldElement.textContent =
            net.toLocaleString();
    }

    function updateCombatButton() {
        startStopButton.textContent =
            combatRunning
                ? 'STOP'
                : 'START';

        startStopButton.classList.toggle(
            'tf-stop',
            combatRunning
        );
    }

    // =========================================================
    // COMBAT VICTORIES
    // =========================================================

    function getVictoryEntries() {
        return Array.from(
            document.querySelectorAll(
                '[data-sent-at]'
            )
        ).filter(
            entry =>
                entry.querySelector(
                    '.combat-val--xp'
                ) &&
                entry.querySelector(
                    '.combat-val--gold'
                )
        );
    }

    function markCurrentVictoriesProcessed() {
        getVictoryEntries()
            .forEach(
                entry => {
                    const id =
                        entry.dataset
                            .sentAt;

                    if (id) {
                        processedVictories.add(
                            id
                        );
                    }
                }
            );
    }

    markCurrentVictoriesProcessed();

    function processVictory(entry) {
        if (
            !settings
                .combatTrackerEnabled
        ) {
            return;
        }

        const id =
            entry.dataset.sentAt;

        if (
            !id ||
            processedVictories.has(
                id
            )
        ) {
            return;
        }

        const xp =
            numberFromText(
                entry.querySelector(
                    '.combat-val--xp'
                )?.textContent
            );

        const gold =
            numberFromText(
                entry.querySelector(
                    '.combat-val--gold'
                )?.textContent
            );

        if (
            xp <= 0 ||
            gold <= 0
        ) {
            return;
        }

        processedVictories.add(
            id
        );

        if (
            !combatRunning &&
            combatKills === 0
        ) {
            combatRunning = true;

            initializeItemTracking();

            combatPanel.style.display =
                'block';

            combatStatusElement.textContent =
                'Tracking combat...';

            updateCombatButton();
        }

        if (!combatRunning) {
            return;
        }

        combatKills += 1;
        combatTotalXP += xp;
        combatGrossGold += gold;

        updateCombatDisplay();
    }

    function scanVictories() {
        getVictoryEntries()
            .forEach(
                processVictory
            );
    }

    // =========================================================
    // COMBAT BUTTONS
    // =========================================================

    startStopButton.addEventListener(
        'click',
        () => {

            if (combatRunning) {
                combatRunning =
                    false;
            } else {
                combatKills = 0;
                combatTotalXP = 0;
                combatGrossGold = 0;

                consumedItems.clear();
                sessionPrices.clear();
                lastQuantities.clear();
                pendingItemDecreases.clear();

                processedVictories.clear();
                markCurrentVictoriesProcessed();

                combatRunning =
                    true;

                initializeItemTracking();

                combatPanel.style.display =
                    'block';
            }

            updateCombatButton();
            updateCombatDisplay();
        }
    );

    combatResetButton.addEventListener(
        'click',
        () => {

            combatRunning =
                false;

            combatKills = 0;
            combatTotalXP = 0;
            combatGrossGold = 0;

            consumedItems.clear();
            sessionPrices.clear();
            lastQuantities.clear();
            pendingItemDecreases.clear();

            processedVictories.clear();
            markCurrentVictoriesProcessed();

            updateCombatButton();
            updateCombatDisplay();
        }
    );

    combatCloseButton.addEventListener(
        'click',
        () => {
            combatPanel.style.display =
                'none';
        }
    );

    combatMinimizeButton.addEventListener(
        'click',
        () => {

            combatMinimized =
                !combatMinimized;

            combatBody.style.display =
                combatMinimized
                    ? 'none'
                    : 'block';

            combatMinimizeButton.textContent =
                combatMinimized
                    ? '+'
                    : '−';
        }
    );

    // =========================================================
    // ACTIVITY STATE
    // =========================================================

    let activityStarted =
        false;

    let activityPanelClosed =
        false;

    let activityMinimized =
        false;

    let activityStartTime =
        0;

    let activitySkill =
        null;

    let activityTaskName =
        null;

    let activityHistoryKey =
        null;

    let activityHistoryCommittedActions =
        0;

    let activityHistoryCommittedXP =
        0;

    let activityHistoryCommittedItems =
        0;

    let activityCycleObservedThisSession =
        false;

    let activityLastXP =
        null;

    let activityLastRequiredXP =
        null;

    let activityLastLevel =
        null;

    let activityTotalXP =
        0;

    let activityActions =
        0;

    let activityLastCyclesLeft =
        null;

    /*
     * ACTUAL produced items.
     *
     * This is incremented from Tidefall's
     * +N Item reward popup.
     */
    let activityItemsProduced =
        0;

    /*
     * Number of reward popups observed.
     * Useful for diagnostics and averaging.
     */
    let activityRewardEvents =
        0;

    let activityCycleSeconds =
        null;

    let activityLastCycleCountdown =
        null;

    /*
     * Frozen display estimates.
     */
    let activityEstimatedXPPerAction =
        null;

    let activityEstimatedItemsPerAction =
        null;

    let activityEstimatedXPPerHour =
        null;

    let activityEstimatedItemsPerHour =
        null;

    let activityEstimatedActionsToLevel =
        null;

    let activityEstimatedTimeToLevel =
        null;

    let activityEstimatedNextLevel =
        null;

    let activityEstimateLastUpdated =
        0;

    // =========================================================
    // ACTIVITY DOM
    // =========================================================

    function getActivityTaskPanel() {
        return document.querySelector(
            '#active-task-panel'
        );
    }

    function getCurrentActivity() {
        const panel =
            getActivityTaskPanel();

        if (
            !panel ||
            panel.dataset.state !==
                'running'
        ) {
            return null;
        }

        const skill =
            String(
                panel.dataset.skill ||
                ''
            )
                .trim()
                .toLowerCase();

        if (
            !skill ||
            skill === 'gunnery'
        ) {
            return null;
        }

        const taskName =
            document.querySelector(
                '#task-name'
            )
                ?.textContent
                ?.trim() ||
            titleCaseSkill(
                skill
            );

        return {
            panel,
            skill,
            taskName,
            historyKey:
                buildActivityHistoryKey(
                    panel,
                    skill,
                    taskName
                )
        };
    }

    function getActivityCyclesLeft() {
        const element =
            document.querySelector(
                '#task-cycles-left'
            );

        if (!element) {
            return null;
        }

        const match =
            element.textContent
                .replace(/,/g, '')
                .match(/\d+/);

        return match
            ? Number(match[0])
            : null;
    }

    function getActivityCycleCountdown() {
        const element =
            document.querySelector(
                '#task-cycle'
            );

        if (!element) {
            return null;
        }

        const match =
            element.textContent
                .match(
                    /(\d+)\s*s/i
                );

        return match
            ? Number(match[1])
            : null;
    }

    // =========================================================
    // ACTIVITY HISTORY SESSION DATA
    // =========================================================

    function applyHistoricalActivityEstimates() {
        const record =
            getActivityHistoryRecord(
                activityHistoryKey
            );

        if (!record) {
            return;
        }

        const totalActions =
            Number(record.totalActions) || 0;

        const totalXP =
            Number(record.totalXP) || 0;

        const totalItems =
            Number(record.totalItems) || 0;

        const savedCycleSeconds =
            Number(record.cycleSeconds) || 0;

        if (
            totalActions > 0 &&
            totalXP > 0
        ) {
            activityEstimatedXPPerAction =
                totalXP /
                totalActions;
        }

        if (
            totalActions > 0 &&
            totalItems > 0
        ) {
            activityEstimatedItemsPerAction =
                totalItems /
                totalActions;
        }

        if (
            savedCycleSeconds > 0
        ) {
            activityCycleSeconds =
                savedCycleSeconds;
        }

        if (
            activityCycleSeconds > 0
        ) {
            const actionsPerHour =
                3600 /
                activityCycleSeconds;

            if (
                activityEstimatedXPPerAction !==
                    null
            ) {
                activityEstimatedXPPerHour =
                    actionsPerHour *
                    activityEstimatedXPPerAction;
            }

            if (
                activityEstimatedItemsPerAction !==
                    null
            ) {
                activityEstimatedItemsPerHour =
                    actionsPerHour *
                    activityEstimatedItemsPerAction;
            }
        }
    }

    function commitCurrentActivityHistory() {
        if (
            !activityHistoryKey ||
            !activitySkill ||
            !activityTaskName
        ) {
            return;
        }

        const newActions =
            Math.max(
                0,
                activityActions -
                    activityHistoryCommittedActions
            );

        const newXP =
            Math.max(
                0,
                activityTotalXP -
                    activityHistoryCommittedXP
            );

        const newItems =
            Math.max(
                0,
                activityItemsProduced -
                    activityHistoryCommittedItems
            );

        const existing =
            getActivityHistoryRecord(
                activityHistoryKey
            ) || {};

        const record = {
            key:
                activityHistoryKey,

            skill:
                activitySkill,

            taskName:
                activityTaskName,

            totalActions:
                (Number(existing.totalActions) || 0) +
                newActions,

            totalXP:
                (Number(existing.totalXP) || 0) +
                newXP,

            totalItems:
                (Number(existing.totalItems) || 0) +
                newItems,

            cycleSeconds:
                activityCycleSeconds > 0
                    ? activityCycleSeconds
                    : (
                        Number(
                            existing.cycleSeconds
                        ) || null
                    ),

            updated:
                Date.now()
        };

        activityHistory[
            activityHistoryKey
        ] = record;

        activityHistoryCommittedActions =
            activityActions;

        activityHistoryCommittedXP =
            activityTotalXP;

        activityHistoryCommittedItems =
            activityItemsProduced;

        saveActivityHistory();
    }

    // =========================================================
    // ACTIVITY RESET
    // =========================================================

    function clearActivityEstimates() {
        activityEstimatedXPPerAction =
            null;

        activityEstimatedItemsPerAction =
            null;

        activityEstimatedXPPerHour =
            null;

        activityEstimatedItemsPerHour =
            null;

        activityEstimatedActionsToLevel =
            null;

        activityEstimatedTimeToLevel =
            null;

        activityEstimatedNextLevel =
            null;

        activityEstimateLastUpdated =
            0;
    }

    function resetActivitySession(
        clearActivity = true
    ) {
        commitCurrentActivityHistory();

        activityStarted =
            false;

        activityStartTime =
            0;

        activityLastXP =
            null;

        activityLastRequiredXP =
            null;

        activityLastLevel =
            null;

        activityTotalXP =
            0;

        activityActions =
            0;

        activityLastCyclesLeft =
            null;

        activityItemsProduced =
            0;

        activityRewardEvents =
            0;

        activityCycleSeconds =
            null;

        activityLastCycleCountdown =
            null;

        activityCycleObservedThisSession =
            false;

        activityHistoryCommittedActions =
            0;

        activityHistoryCommittedXP =
            0;

        activityHistoryCommittedItems =
            0;

        clearActivityEstimates();

        activityPanel.style.display =
            'none';

        if (clearActivity) {
            activitySkill =
                null;

            activityTaskName =
                null;

            activityHistoryKey =
                null;
        }
    }

    function startActivitySession(
        activity
    ) {
        activityStarted =
            true;

        activityPanelClosed =
            false;

        activityMinimized =
            false;

        activityBody.style.display =
            'block';

        activityMinimizeButton.textContent =
            '−';

        activitySkill =
            activity.skill;

        activityTaskName =
            activity.taskName;

        activityHistoryKey =
            activity.historyKey ||
            buildActivityHistoryKey(
                activity.panel,
                activity.skill,
                activity.taskName
            );

        activityHistoryCommittedActions =
            0;

        activityHistoryCommittedXP =
            0;

        activityHistoryCommittedItems =
            0;

        activityCycleObservedThisSession =
            false;

        activityStartTime =
            Date.now();

        const xp =
            getSkillXP(
                activitySkill
            );

        activityLastXP =
            xp
                ? xp.current
                : null;

        activityLastRequiredXP =
            xp
                ? xp.required
                : null;

        activityLastLevel =
            getSkillLevel(
                activitySkill
            );

        activityTotalXP =
            0;

        activityActions =
            0;

        activityItemsProduced =
            0;

        activityRewardEvents =
            0;

        activityLastCyclesLeft =
            getActivityCyclesLeft();

        activityLastCycleCountdown =
            getActivityCycleCountdown();

        activityCycleSeconds =
            null;

        clearActivityEstimates();

        /*
         * Use remembered rates immediately.
         * Current-session observations will refine
         * these values as new actions complete.
         */
        applyHistoricalActivityEstimates();

        activityPanel.style.display =
            'none';
    }

    // =========================================================
    // ACTIVITY REWARD POPUPS
    // =========================================================

    function processActivityRewardElement(
        element
    ) {
        if (
            !activityStarted ||
            !settings
                .activityTrackerEnabled
        ) {
            return;
        }

        if (
            !element.matches(
                '.rf-token.rf-token--item'
            )
        ) {
            return;
        }

        const text =
            element.textContent
                ?.trim() ||
            '';

        /*
         * Examples:
         *
         * +1 Darkiron Bar
         * +2 Darkiron Bar
         * +3 Oak Plank
         */
        const match =
            text.match(
                /^\+(\d+)\s+(.+)$/
            );

        if (!match) {
            return;
        }

        const quantity =
            Number(
                match[1]
            );

        if (
            !Number.isFinite(
                quantity
            ) ||
            quantity <= 0
        ) {
            return;
        }

        activityItemsProduced +=
            quantity;

        activityRewardEvents +=
            1;

        /*
         * First reward:
         * get a useful Items/hour estimate
         * immediately.
         *
         * Afterward the normal 5-minute
         * refresh rules apply.
         */
        if (
            activityRewardEvents === 1
        ) {
            setTimeout(
                () => {
                    recalculateActivityEstimates(
                        true
                    );

                    updateActivityDisplay();
                },
                250
            );
        }
    }

    const activityRewardObserver =
        new MutationObserver(
            mutations => {

                for (
                    const mutation
                    of mutations
                ) {
                    for (
                        const node
                        of mutation.addedNodes
                    ) {
                        if (
                            !(
                                node instanceof
                                HTMLElement
                            )
                        ) {
                            continue;
                        }

                        if (
                            node.matches?.(
                                '.rf-token.rf-token--item'
                            )
                        ) {
                            processActivityRewardElement(
                                node
                            );
                        }

                        node
                            .querySelectorAll?.(
                                '.rf-token.rf-token--item'
                            )
                            .forEach(
                                processActivityRewardElement
                            );
                    }
                }
            }
        );

    activityRewardObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

    // =========================================================
    // ACTIVITY CYCLE TIME
    // =========================================================

    function scanActivityCycleDuration() {
        const countdown =
            getActivityCycleCountdown();

        if (
            countdown === null
        ) {
            return;
        }

        if (
            activityLastCycleCountdown ===
            null
        ) {
            activityLastCycleCountdown =
                countdown;

            return;
        }

        /*
         * Detect:
         *
         * 1s -> 25s
         *
         * as the next cycle beginning.
         */
        if (
            countdown >
            activityLastCycleCountdown
        ) {
            /*
             * Use the highest reset value seen.
             *
             * A 250ms polling delay might occasionally
             * catch 24 instead of 25.
             */
            if (
                !activityCycleObservedThisSession
            ) {
                activityCycleSeconds =
                    countdown;

                activityCycleObservedThisSession =
                    true;
            } else if (
                countdown >
                activityCycleSeconds
            ) {
                activityCycleSeconds =
                    countdown;
            }

            if (
                activityEstimateLastUpdated ===
                0
            ) {
                recalculateActivityEstimates(
                    true
                );
            }
        }

        activityLastCycleCountdown =
            countdown;
    }

    // =========================================================
    // ACTIVITY XP
    // =========================================================

    function scanActivityXP() {
        if (
            !activityStarted ||
            !activitySkill
        ) {
            return;
        }

        const xp =
            getSkillXP(
                activitySkill
            );

        if (!xp) {
            return;
        }

        const level =
            getSkillLevel(
                activitySkill
            );

        if (
            activityLastXP ===
            null
        ) {
            activityLastXP =
                xp.current;

            activityLastRequiredXP =
                xp.required;

            activityLastLevel =
                level;

            return;
        }

        let gained = 0;

        if (
            xp.current >=
            activityLastXP
        ) {
            gained =
                xp.current -
                activityLastXP;
        } else if (
            activityLastRequiredXP !==
            null
        ) {
            /*
             * Handle a level-up.
             */
            gained =
                Math.max(
                    0,
                    activityLastRequiredXP -
                        activityLastXP
                ) +
                xp.current;
        }

        if (
            gained > 0
        ) {
            activityTotalXP +=
                gained;
        }

        if (
            level !== null &&
            activityLastLevel !==
                null &&
            level !==
                activityLastLevel
        ) {
            /*
             * Update level estimates immediately
             * after leveling.
             */
            activityEstimateLastUpdated =
                0;
        }

        activityLastXP =
            xp.current;

        activityLastRequiredXP =
            xp.required;

        activityLastLevel =
            level;
    }

    // =========================================================
    // ACTIVITY ACTIONS
    // =========================================================

    function scanActivityActions() {
        const cyclesLeft =
            getActivityCyclesLeft();

        if (
            cyclesLeft === null
        ) {
            return;
        }

        if (
            activityLastCyclesLeft ===
            null
        ) {
            activityLastCyclesLeft =
                cyclesLeft;

            return;
        }

        if (
            cyclesLeft <
            activityLastCyclesLeft
        ) {
            const completed =
                activityLastCyclesLeft -
                cyclesLeft;

            const previousActions =
                activityActions;

            activityActions +=
                completed;

            /*
             * If the user closed the Activity Session,
             * the next completed action reopens it.
             */
            activityPanelClosed =
                false;

            /*
             * Refresh level progress after every completed
             * action. XP/hour and Items/hour remain on their
             * existing five-minute smoothing schedule.
             */
            setTimeout(
                () => {
                    scanActivityXP();
                    updateActivityLevelEstimate();
                    updateActivityDisplay();
                },
                350
            );

            /*
             * First action completed:
             * show tracker.
             */
            if (
                previousActions === 0 &&
                activityActions > 0
            ) {
                if (
                    !activityPanelClosed
                ) {
                    activityPanel.style.display =
                        'block';
                }

                /*
                 * Give XP and reward popups a moment
                 * to arrive.
                 */
                setTimeout(
                    () => {
                        scanActivityXP();

                        recalculateActivityEstimates(
                            true
                        );

                        updateActivityDisplay();
                    },
                    700
                );
            }
        }

        activityLastCyclesLeft =
            cyclesLeft;
    }

    // =========================================================
    // ACTIVITY ESTIMATES
    // =========================================================

    function getActivityRemainingXP() {
        const xp =
            getSkillXP(
                activitySkill
            );

        if (!xp) {
            return null;
        }

        return Math.max(
            0,
            xp.required -
                xp.current
        );
    }

    function recalculateActivityEstimates(
        force = false
    ) {
        if (
            !activityStarted ||
            activityActions <= 0
        ) {
            return;
        }

        const now =
            Date.now();

        if (
            !force &&
            activityEstimateLastUpdated >
                0 &&
            now -
                activityEstimateLastUpdated <
                ACTIVITY_ESTIMATE_REFRESH_MS
        ) {
            return;
        }

        // -----------------------------------------------------
        // XP PER ACTION
        // -----------------------------------------------------

        const historicalRecord =
            getActivityHistoryRecord(
                activityHistoryKey
            );

        const historicalActions =
            Number(
                historicalRecord
                    ?.totalActions
            ) || 0;

        const historicalXP =
            Number(
                historicalRecord
                    ?.totalXP
            ) || 0;

        const historicalItems =
            Number(
                historicalRecord
                    ?.totalItems
            ) || 0;

        const combinedActions =
            historicalActions +
            activityActions;

        const combinedXP =
            historicalXP +
            activityTotalXP;

        const combinedItems =
            historicalItems +
            activityItemsProduced;

        if (
            combinedXP > 0 &&
            combinedActions > 0
        ) {
            activityEstimatedXPPerAction =
                combinedXP /
                combinedActions;
        }

        // -----------------------------------------------------
        // ACTUAL ITEMS PER ACTION
        // -----------------------------------------------------

        /*
         * This is where mastery is accounted for.
         *
         * Example:
         *
         * 5 actions
         *
         * rewards:
         * 1, 1, 2, 1, 1
         *
         * total items = 6
         *
         * items/action = 6 / 5 = 1.2
         */
        if (
            combinedItems > 0 &&
            combinedActions > 0
        ) {
            activityEstimatedItemsPerAction =
                combinedItems /
                combinedActions;
        }

        // -----------------------------------------------------
        // HOURLY RATES
        // -----------------------------------------------------

        if (
            activityCycleSeconds !==
                null &&
            activityCycleSeconds > 0
        ) {
            const actionsPerHour =
                3600 /
                activityCycleSeconds;

            if (
                activityEstimatedXPPerAction !==
                    null
            ) {
                activityEstimatedXPPerHour =
                    actionsPerHour *
                    activityEstimatedXPPerAction;
            }

            if (
                activityEstimatedItemsPerAction !==
                    null
            ) {
                activityEstimatedItemsPerHour =
                    actionsPerHour *
                    activityEstimatedItemsPerAction;
            }
        }

        // -----------------------------------------------------
        // NEXT LEVEL
        // -----------------------------------------------------

        const level =
            getSkillLevel(
                activitySkill
            );

        activityEstimatedNextLevel =
            level !== null
                ? level + 1
                : null;

        const remainingXP =
            getActivityRemainingXP();

        if (
            remainingXP !== null &&
            activityEstimatedXPPerAction !==
                null &&
            activityEstimatedXPPerAction >
                0
        ) {
            activityEstimatedActionsToLevel =
                Math.ceil(
                    remainingXP /
                    activityEstimatedXPPerAction
                );

            if (
                activityCycleSeconds !==
                    null
            ) {
                activityEstimatedTimeToLevel =
                    activityEstimatedActionsToLevel *
                    activityCycleSeconds;
            }
        }

        /*
         * Freeze these estimates for five minutes.
         */
        if (
            activityEstimatedXPPerHour !==
                null ||
            activityEstimatedItemsPerHour !==
                null
        ) {
            activityEstimateLastUpdated =
                now;

            /*
             * Save only newly observed session totals.
             * Raw historical totals are retained so the
             * averages improve over time.
             */
            commitCurrentActivityHistory();
        }
    }

    function updateActivityLevelEstimate() {
        if (
            !activityStarted ||
            !activitySkill ||
            activityEstimatedXPPerAction ===
                null ||
            activityEstimatedXPPerAction <=
                0
        ) {
            return;
        }

        const level =
            getSkillLevel(
                activitySkill
            );

        activityEstimatedNextLevel =
            level !== null
                ? level + 1
                : null;

        const remainingXP =
            getActivityRemainingXP();

        if (
            remainingXP === null
        ) {
            return;
        }

        activityEstimatedActionsToLevel =
            Math.ceil(
                remainingXP /
                activityEstimatedXPPerAction
            );

        if (
            activityCycleSeconds !==
                null &&
            activityCycleSeconds > 0
        ) {
            activityEstimatedTimeToLevel =
                activityEstimatedActionsToLevel *
                activityCycleSeconds;
        }
    }

    // =========================================================
    // ACTIVITY DISPLAY
    // =========================================================

    function getActivityElapsedSeconds() {
        if (
            !activityStarted ||
            !activityStartTime
        ) {
            return 0;
        }

        return (
            Date.now() -
            activityStartTime
        ) / 1000;
    }

    function updateActivityDisplay() {
        updateActivityLevelEstimate();

        if (
            !settings
                .activityTrackerEnabled ||
            !activityStarted ||
            activityActions <= 0 ||
            activityPanelClosed
        ) {
            activityPanel.style.display =
                'none';

            return;
        }

        activityPanel.style.display =
            'block';

        activityXpHourElement.textContent =
            activityEstimatedXPPerHour ===
                null
                ? '—'
                : Math.round(
                    activityEstimatedXPPerHour
                ).toLocaleString();

        activityItemsHourElement.textContent =
            activityEstimatedItemsPerHour ===
                null
                ? '—'
                : Math.round(
                    activityEstimatedItemsPerHour
                ).toLocaleString();

        if (
            settings
                .activityLevelMode ===
            'time'
        ) {
            activityLevelLabel.textContent =
                activityEstimatedNextLevel !==
                    null
                    ? `Time to Level ${activityEstimatedNextLevel}`
                    : 'Time to Level';

            activityLevelValue.textContent =
                activityEstimatedTimeToLevel ===
                    null
                    ? '—'
                    : formatDuration(
                        activityEstimatedTimeToLevel
                    );
        } else {
            activityLevelLabel.textContent =
                activityEstimatedNextLevel !==
                    null
                    ? `Actions to Level ${activityEstimatedNextLevel}`
                    : 'Actions to Level';

            activityLevelValue.textContent =
                activityEstimatedActionsToLevel ===
                    null
                    ? '—'
                    : activityEstimatedActionsToLevel
                        .toLocaleString();
        }

        activityElapsedElement.textContent =
            formatDuration(
                getActivityElapsedSeconds()
            );

        activitySkillElement.textContent =
            `${titleCaseSkill(activitySkill)} • ${activityTaskName}`;
    }

    // =========================================================
    // ACTIVITY SCANNER
    // =========================================================

    function scanActivity() {
        if (
            !settings
                .activityTrackerEnabled
        ) {
            activityPanel.style.display =
                'none';

            return;
        }

        const activity =
            getCurrentActivity();

        if (!activity) {
            activityPanel.style.display =
                'none';

            return;
        }

        if (
            !activityStarted
        ) {
            startActivitySession(
                activity
            );
        } else if (
            activity.skill !==
                activitySkill ||
            activity.taskName !==
                activityTaskName ||
            activity.historyKey !==
                activityHistoryKey
        ) {
            resetActivitySession(
                true
            );

            startActivitySession(
                activity
            );
        }

        scanActivityCycleDuration();

        scanActivityXP();

        scanActivityActions();

        recalculateActivityEstimates(
            false
        );

        updateActivityDisplay();
    }

    // =========================================================
    // ACTIVITY BUTTONS
    // =========================================================

    activityResetButton.addEventListener(
        'click',
        () => {

            const activity =
                getCurrentActivity();

            resetActivitySession(
                true
            );

            if (activity) {
                startActivitySession(
                    activity
                );
            }
        }
    );

    activityMinimizeButton.addEventListener(
        'click',
        () => {

            activityMinimized =
                !activityMinimized;

            activityBody.style.display =
                activityMinimized
                    ? 'none'
                    : 'block';

            activityMinimizeButton.textContent =
                activityMinimized
                    ? '+'
                    : '−';
        }
    );

    activityCloseButton.addEventListener(
        'click',
        () => {

            activityPanelClosed =
                true;

            activityPanel.style.display =
                'none';
        }
    );

    // =========================================================
    // STARTUP DISPLAY & CAMERA
    // =========================================================

    let startupZoomApplied =
        false;

    let startupFollowShipApplied =
        false;

    let startupControlsFirstSeenAt =
        null;

    let startupSequenceRunning =
        false;

    let navigationWasActive =
        false;

    let navigationFollowPending =
        false;

    const STARTUP_CAMERA_DELAY_MS =
        6000;

    function clampStartupZoomPercent(
        value
    ) {
        const numeric =
            Number(value);

        if (
            !Number.isFinite(numeric)
        ) {
            return 100;
        }

        return Math.max(
            0,
            Math.min(
                100,
                Math.round(
                    numeric * 2
                ) / 2
            )
        );
    }

    function getStartupZoomOutClicks(
        percent
    ) {
        const clamped =
            clampStartupZoomPercent(
                percent
            );

        /*
         * 0%   = fully zoomed in
         * 100% = fully zoomed out
         */
        return Math.round(
            clamped /
            12.5
        );
    }

    function waitMilliseconds(
        milliseconds
    ) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );
    }

    async function applyStartupZoomOnce() {
        if (
            startupZoomApplied ||
            !settings.startupZoomEnabled
        ) {
            return;
        }

        const zoomInButton =
            document.querySelector(
                '#map-btn-zoom-in'
            );

        const zoomOutButton =
            document.querySelector(
                '#map-btn-zoom-out'
            );

        if (
            !(zoomInButton instanceof HTMLElement) ||
            !(zoomOutButton instanceof HTMLElement)
        ) {
            return;
        }

        /*
         * Tidefall can render the map buttons before the
         * camera listeners are fully ready. Wait for the
         * startup delay, then pace every camera click.
         */
        /*
         * Wait until Tidefall has finished applying its own
         * startup camera state, then normalize to fully zoomed
         * in and move outward to the saved notch.
         */
        for (
            let index = 0;
            index < 8;
            index += 1
        ) {
            zoomInButton.click();

            await waitMilliseconds(
                140
            );
        }

        /*
         * Give the camera a moment to settle at the known
         * fully zoomed-in endpoint before moving outward.
         */
        await waitMilliseconds(
            500
        );

        const zoomOutClicks =
            getStartupZoomOutClicks(
                settings.startupZoomPercent
            );

        for (
            let index = 0;
            index < zoomOutClicks;
            index += 1
        ) {
            zoomOutButton.click();

            await waitMilliseconds(
                140
            );
        }

        startupZoomApplied =
            true;
    }

    async function enableFollowShipAfterSailing() {
        if (
            !settings.startupFollowShipEnabled
        ) {
            return;
        }

        /*
         * Setting sail can rebuild or briefly disable parts of
         * the map UI, so retry for a few seconds. This only runs
         * when a new sailing action is detected; it does not
         * continuously force Follow Ship back on.
         */
        await waitMilliseconds(
            500
        );

        for (
            let attempt = 0;
            attempt < 10;
            attempt += 1
        ) {
            const followButton =
                document.querySelector(
                    '#map-btn-follow'
                );

            if (
                followButton instanceof
                HTMLElement
            ) {
                const isPressed =
                    followButton.getAttribute(
                        'aria-pressed'
                    ) === 'true';

                if (isPressed) {
                    return;
                }

                followButton.click();

                await waitMilliseconds(
                    300
                );

                if (
                    followButton.getAttribute(
                        'aria-pressed'
                    ) === 'true'
                ) {
                    return;
                }
            }

            await waitMilliseconds(
                300
            );
        }
    }

    function isShipTravelActivityActive() {
        const candidates =
            Array.from(
                document.querySelectorAll(
                    '.task-bar-state.task-bar--sailing, .task-bar-state.task-bar--hauling'
                )
            );

        return candidates.some(
            taskBar => {

                /*
                 * Tidefall keeps inactive task-bar states in
                 * the DOM, so only treat a visible state as
                 * active travel.
                 */
                const style =
                    window.getComputedStyle(
                        taskBar
                    );

                const isVisible =
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number(
                        style.opacity || 1
                    ) !== 0 &&
                    taskBar.getClientRects().length > 0;

                if (!isVisible) {
                    return false;
                }

                if (
                    taskBar.classList.contains(
                        'task-bar--hauling'
                    )
                ) {
                    const haulName =
                        taskBar.querySelector(
                            '#haul-name'
                        )
                            ?.textContent
                            ?.trim() ||
                        '';

                    const haulSub =
                        taskBar.querySelector(
                            '#haul-sub'
                        )
                            ?.textContent
                            ?.trim()
                            ?.toLowerCase() ||
                        '';

                    return Boolean(
                        haulName &&
                        haulSub.startsWith(
                            'deliver to'
                        )
                    );
                }

                const title =
                    taskBar.querySelector(
                        '.context-title'
                    )
                        ?.textContent
                        ?.trim()
                        ?.toLowerCase() ||
                    '';

                const destination =
                    taskBar.querySelector(
                        '#task-bar-nav-dest'
                    )
                        ?.textContent
                        ?.trim()
                        ?.toLowerCase() ||
                    '';

                return (
                    title === 'navigation' ||
                    destination.startsWith(
                        'sailing to'
                    )
                );
            }
        );
    }

    function checkNavigationFollowShip() {
        const navigationActive =
            isShipTravelActivityActive();

        /*
         * Trigger only on the transition into Navigation.
         * If the user pans the map afterward, we leave it alone
         * until Navigation stops and starts again.
         */
        if (
            navigationActive &&
            !navigationWasActive
        ) {
            navigationFollowPending =
                true;

            setTimeout(
                () => {
                    if (
                        navigationFollowPending &&
                        isShipTravelActivityActive()
                    ) {
                        void enableFollowShipAfterSailing();

                        navigationFollowPending =
                            false;
                    }
                },
                650
            );
        }

        if (!navigationActive) {
            navigationFollowPending =
                false;
        }

        navigationWasActive =
            navigationActive;
    }

    async function applyStartupFollowShipOnce() {
        if (
            startupFollowShipApplied ||
            !settings.startupFollowShipEnabled
        ) {
            return;
        }

        const followButton =
            document.querySelector(
                '#map-btn-follow'
            );

        if (
            !(followButton instanceof HTMLElement)
        ) {
            return;
        }

        if (
            followButton.getAttribute(
                'aria-pressed'
            ) === 'true'
        ) {
            startupFollowShipApplied =
                true;

            return;
        }

        /*
         * Retry because the button can exist before Tidefall's
         * follow-camera click handler is attached.
         */
        for (
            let attempt = 0;
            attempt < 5;
            attempt += 1
        ) {
            followButton.click();

            await waitMilliseconds(
                400
            );

            if (
                followButton.getAttribute(
                    'aria-pressed'
                ) === 'true'
            ) {
                startupFollowShipApplied =
                    true;

                return;
            }
        }
    }

    async function applyStartupDisplayAndCamera() {
        if (
            startupSequenceRunning
        ) {
            return;
        }

        const zoomInButton =
            document.querySelector(
                '#map-btn-zoom-in'
            );

        const zoomOutButton =
            document.querySelector(
                '#map-btn-zoom-out'
            );

        const followButton =
            document.querySelector(
                '#map-btn-follow'
            );

        if (
            !(zoomInButton instanceof HTMLElement) ||
            !(zoomOutButton instanceof HTMLElement) ||
            !(followButton instanceof HTMLElement)
        ) {
            startupControlsFirstSeenAt =
                null;

            return;
        }

        if (
            startupControlsFirstSeenAt ===
            null
        ) {
            startupControlsFirstSeenAt =
                Date.now();

            return;
        }

        if (
            Date.now() -
                startupControlsFirstSeenAt <
            STARTUP_CAMERA_DELAY_MS
        ) {
            return;
        }

        if (
            (
                startupZoomApplied ||
                !settings.startupZoomEnabled
            ) &&
            (
                startupFollowShipApplied ||
                !settings.startupFollowShipEnabled
            )
        ) {
            return;
        }

        startupSequenceRunning =
            true;

        try {
            await applyStartupZoomOnce();

            await waitMilliseconds(
                250
            );

            await applyStartupFollowShipOnce();
        } finally {
            startupSequenceRunning =
                false;
        }
    }

    // =========================================================
    // SETTINGS UI
    // =========================================================

    function createToggle(
        settingKey
    ) {
        const toggle =
            document.createElement(
                'button'
            );

        toggle.type =
            'button';

        toggle.className =
            'tf-carl-toggle';

        toggle.dataset.setting =
            settingKey;

        toggle.addEventListener(
            'click',
            () => {

                updateSetting(
                    settingKey,
                    !settings[
                        settingKey
                    ]
                );
            }
        );

        return toggle;
    }

    function createNumberInput(
        settingKey,
        min,
        max,
        unit
    ) {
        const wrapper =
            document.createElement(
                'div'
            );

        wrapper.className =
            'tf-carl-number-wrap';

        const input =
            document.createElement(
                'input'
            );

        input.type =
            'number';

        input.min =
            String(min);

        input.max =
            String(max);

        input.step =
            '1';

        input.className =
            'tf-carl-number';

        input.dataset.setting =
            settingKey;

        input.value =
            settings[settingKey];

        input.addEventListener(
            'change',
            () => {

                let value =
                    Number(
                        input.value
                    );

                if (
                    !Number.isFinite(
                        value
                    )
                ) {
                    value =
                        DEFAULT_SETTINGS[
                            settingKey
                        ];
                }

                value =
                    Math.max(
                        min,
                        Math.min(
                            max,
                            Math.round(
                                value
                            )
                        )
                    );

                updateSetting(
                    settingKey,
                    value
                );
            }
        );

        const unitElement =
            document.createElement(
                'span'
            );

        unitElement.className =
            'tf-carl-unit';

        unitElement.textContent =
            unit;

        wrapper.append(
            input,
            unitElement
        );

        return wrapper;
    }


    function createSliderInput(
        settingKey,
        min,
        max,
        step,
        suffix = ''
    ) {
        const wrapper =
            document.createElement(
                'div'
            );

        wrapper.className =
            'tf-carl-slider-wrap';

        const input =
            document.createElement(
                'input'
            );

        input.type =
            'range';

        input.min =
            String(min);

        input.max =
            String(max);

        input.step =
            String(step);

        input.className =
            'tf-carl-slider';

        input.dataset.setting =
            settingKey;

        input.value =
            settings[settingKey];

        const valueElement =
            document.createElement(
                'span'
            );

        valueElement.className =
            'tf-carl-slider-value';

        const refreshValue =
            () => {
                valueElement.textContent =
                    `${input.value}${suffix}`;
            };

        refreshValue();

        input.addEventListener(
            'input',
            () => {
                refreshValue();
            }
        );

        input.addEventListener(
            'change',
            () => {
                let value =
                    Number(
                        input.value
                    );

                if (
                    !Number.isFinite(value)
                ) {
                    value =
                        DEFAULT_SETTINGS[
                            settingKey
                        ];
                }

                value =
                    Math.max(
                        min,
                        Math.min(
                            max,
                            value
                        )
                    );

                if (
                    step === 12.5
                ) {
                    value =
                        Math.round(
                            value / 12.5
                        ) * 12.5;
                }

                updateSetting(
                    settingKey,
                    value
                );

                input.value =
                    String(value);

                refreshValue();
            }
        );

        wrapper.append(
            input,
            valueElement
        );

        return wrapper;
    }

    function createSelect(
        settingKey,
        options
    ) {
        const select =
            document.createElement(
                'select'
            );

        select.className =
            'tf-carl-select';

        select.dataset.setting =
            settingKey;

        for (
            const optionData
            of options
        ) {
            const option =
                document.createElement(
                    'option'
                );

            option.value =
                optionData.value;

            option.textContent =
                optionData.label;

            select.appendChild(
                option
            );
        }

        select.value =
            settings[settingKey];

        select.addEventListener(
            'change',
            () => {

                updateSetting(
                    settingKey,
                    select.value
                );

                updateActivityDisplay();

                if (
                    settingKey ===
                    'cannonDurabilityMode'
                ) {
                    refreshCannonDurabilityDisplay();
                }
            }
        );

        return select;
    }

    function createSettingsCard({
        title,
        description,
        toggleKey,
        valueKey = null,
        min = 0,
        max = 99999,
        unit = '',
        trackerDependent = false,
        extraContent = null
    }) {
        const card =
            document.createElement(
                'div'
            );

        card.className =
            'acp-card tf-carl-card';

        if (
            trackerDependent
        ) {
            card.dataset
                .trackerDependent =
                '1';
        }

        const meta =
            document.createElement(
                'div'
            );

        meta.className =
            'acp-card-meta';

        meta.innerHTML = `
            <div class="acp-card-title">
                ${title}
            </div>

            <div class="acp-card-desc">
                ${description}
            </div>
        `;

        const cardBody =
            document.createElement(
                'div'
            );

        cardBody.className =
            'acp-card-body';

        const row =
            document.createElement(
                'div'
            );

        row.className =
            'tf-carl-toggle-row';

        const label =
            document.createElement(
                'span'
            );

        label.className =
            'tf-carl-setting-label';

        label.textContent =
            'Enabled';

        row.append(
            label,
            createToggle(
                toggleKey
            )
        );

        cardBody.appendChild(
            row
        );

        if (valueKey) {
            const thresholdRow =
                document.createElement(
                    'div'
                );

            thresholdRow.className =
                'tf-carl-threshold-row';

            thresholdRow.dataset
                .parentToggle =
                toggleKey;

            const thresholdLabel =
                document.createElement(
                    'span'
                );

            thresholdLabel.className =
                'tf-carl-setting-label';

            thresholdLabel.textContent =
                'Trigger at';

            thresholdRow.append(
                thresholdLabel,
                createNumberInput(
                    valueKey,
                    min,
                    max,
                    unit
                )
            );

            cardBody.appendChild(
                thresholdRow
            );
        }

        if (
            typeof extraContent ===
            'function'
        ) {
            extraContent(
                cardBody
            );
        }

        card.append(
            meta,
            cardBody
        );

        return card;
    }

    function createSettingsGroup(
        title
    ) {
        const group =
            document.createElement(
                'div'
            );

        group.className =
            'tf-carl-settings-group';

        const heading =
            document.createElement(
                'div'
            );

        heading.className =
            'tf-carl-settings-group-title';

        heading.textContent =
            title;

        group.appendChild(
            heading
        );

        return group;
    }

    function createRefreshCard() {
        const card =
            document.createElement(
                'div'
            );

        card.className =
            'acp-card tf-carl-card';

        const meta =
            document.createElement(
                'div'
            );

        meta.className =
            'acp-card-meta';

        meta.innerHTML = `
            <div class="acp-card-title">
                Refresh Tidefall
            </div>

            <div class="acp-card-desc">
                Reload the current Tidefall page and reapply startup settings.
            </div>
        `;

        const cardBody =
            document.createElement(
                'div'
            );

        cardBody.className =
            'acp-card-body';

        const button =
            document.createElement(
                'button'
            );

        button.type =
            'button';

        button.className =
            'tf-carl-refresh-button';

        button.textContent =
            'REFRESH PAGE';

        button.addEventListener(
            'click',
            () => {
                window.location.reload();
            }
        );

        cardBody.appendChild(
            button
        );

        card.append(
            meta,
            cardBody
        );

        return card;
    }

    function buildCarlSettingsSection() {
        const section =
            document.createElement(
                'section'
            );

        section.id =
            'tf-carl-settings-section';

        section.className =
            'acp-section';

        const combatGroup =
            createSettingsGroup(
                'Combat'
            );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Combat Tracker',

                description:
                    'Track PvE kills, XP, Gunnery level progress, and net session gold.',

                toggleKey:
                    'combatTrackerEnabled'
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Combat Warnings',

                description:
                    'Master switch for combat warnings. Click an active warning to dismiss it until that condition clears.',

                toggleKey:
                    'combatWarningsEnabled'
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Low Hull Warning',

                description:
                    'Warn when hull reaches this percentage.',

                toggleKey:
                    'hullWarningEnabled',

                valueKey:
                    'hullWarningValue',

                min: 0,
                max: 100,
                unit: '%'
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Low Crew Warning',

                description:
                    'Warn when crew reaches this percentage.',

                toggleKey:
                    'crewWarningEnabled',

                valueKey:
                    'crewWarningValue',

                min: 0,
                max: 100,
                unit: '%'
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Low Ammo Warning',

                description:
                    'Warn when ammunition reaches this amount.',

                toggleKey:
                    'ammoWarningEnabled',

                valueKey:
                    'ammoWarningValue',

                min: 0,
                max: 99999,
                unit: 'shots',

                trackerDependent:
                    true
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Low Food Warning',

                description:
                    'Warn when food reaches this amount.',

                toggleKey:
                    'foodWarningEnabled',

                valueKey:
                    'foodWarningValue',

                min: 0,
                max: 99999,
                unit: 'food',

                trackerDependent:
                    true
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Low Repair Kits Warning',

                description:
                    'Warn when repair kits reach this amount.',

                toggleKey:
                    'repairWarningEnabled',

                valueKey:
                    'repairWarningValue',

                min: 0,
                max: 99999,
                unit: 'kits',

                trackerDependent:
                    true
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Cannon Durability',

                description:
                    'Show each cannon\'s current condition directly below its slot.',

                toggleKey:
                    'cannonDurabilityEnabled',

                extraContent:
                    cardBody => {

                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-carl-select-row';

                        row.dataset
                            .parentToggle =
                            'cannonDurabilityEnabled';

                        const label =
                            document.createElement(
                                'span'
                            );

                        label.className =
                            'tf-carl-setting-label';

                        label.textContent =
                            'Display';

                        row.append(
                            label,
                            createSelect(
                                'cannonDurabilityMode',
                                [
                                    {
                                        value:
                                            'percent',
                                        label:
                                            'Percentage'
                                    },
                                    {
                                        value:
                                            'raw',
                                        label:
                                            'Current / Max'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            row
                        );
                    }
            })
        );

        const activityGroup =
            createSettingsGroup(
                'Activity'
            );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Activity Tracker',

                description:
                    'Track non-combat XP, actual mastery-adjusted item output, and next-level progress.',

                toggleKey:
                    'activityTrackerEnabled',

                extraContent:
                    cardBody => {

                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-carl-select-row';

                        row.dataset
                            .parentToggle =
                            'activityTrackerEnabled';

                        const label =
                            document.createElement(
                                'span'
                            );

                        label.className =
                            'tf-carl-setting-label';

                        label.textContent =
                            'Level Estimate';

                        row.append(
                            label,
                            createSelect(
                                'activityLevelMode',
                                [
                                    {
                                        value:
                                            'actions',
                                        label:
                                            'Actions to Level'
                                    },
                                    {
                                        value:
                                            'time',
                                        label:
                                            'Time to Level'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            row
                        );
                    }
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Idle Warning',

                description:
                    'Warn when the task bar remains idle for the configured number of seconds. Suppressed during combat. Click to dismiss until idle clears.',

                toggleKey:
                    'idleWarningEnabled',

                valueKey:
                    'idleWarningSeconds',

                min: 1,
                max: 3600,
                unit: 'seconds'
            })
        );

        const displayGroup =
            createSettingsGroup(
                'Display & Camera'
            );

        displayGroup.appendChild(
            createSettingsCard({
                title:
                    'Startup Zoom',

                description:
                    'Apply the saved camera zoom once when Tidefall loads using one of 9 fixed zoom notches. 0% is fully zoomed in and 100% is fully zoomed out. Manual changes are left alone until the next refresh.',

                toggleKey:
                    'startupZoomEnabled',

                extraContent:
                    cardBody => {

                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-carl-select-row';

                        row.dataset
                            .parentToggle =
                            'startupZoomEnabled';

                        const label =
                            document.createElement(
                                'span'
                            );

                        label.className =
                            'tf-carl-setting-label';

                        label.textContent =
                            'Zoom';

                        row.append(
                            label,
                            createSliderInput(
                                'startupZoomPercent',
                                0,
                                100,
                                12.5,
                                '%'
                            )
                        );

                        cardBody.appendChild(
                            row
                        );
                    }
            })
        );

        displayGroup.appendChild(
            createSettingsCard({
                title:
                    'Startup Follow Ship',

                description:
                    'Turn Follow Ship on when Tidefall loads and whenever Navigation or a hauling delivery becomes active. Manual camera changes are otherwise left alone until a new travel activity starts.',

                toggleKey:
                    'startupFollowShipEnabled'
            })
        );

        displayGroup.appendChild(
            createRefreshCard()
        );

        section.append(
            combatGroup,
            activityGroup,
            displayGroup
        );

        return section;
    }

    function refreshSettingsUI() {
        document
            .querySelectorAll(
                '.tf-carl-toggle[data-setting]'
            )
            .forEach(
                toggle => {

                    const enabled =
                        Boolean(
                            settings[
                                toggle.dataset
                                    .setting
                            ]
                        );

                    toggle.classList.toggle(
                        'tf-enabled',
                        enabled
                    );
                }
            );

        document
            .querySelectorAll(
                '.tf-carl-select[data-setting]'
            )
            .forEach(
                select => {
                    select.value =
                        settings[
                            select.dataset
                                .setting
                        ];
                }
            );

        document
            .querySelectorAll(
                '.tf-carl-slider[data-setting]'
            )
            .forEach(
                input => {
                    input.value =
                        settings[
                            input.dataset
                                .setting
                        ];

                    const valueElement =
                        input.parentElement
                            ?.querySelector(
                                '.tf-carl-slider-value'
                            );

                    if (valueElement) {
                        valueElement.textContent =
                            `${input.value}%`;
                    }
                }
            );

        document
            .querySelectorAll(
                '[data-parent-toggle]'
            )
            .forEach(
                row => {
                    row.classList.toggle(
                        'tf-carl-disabled',
                        !settings[
                            row.dataset
                                .parentToggle
                        ]
                    );
                }
            );
    }

    // =========================================================
    // CARL'S SETTINGS TAB
    // =========================================================

    function getAccountNav() {
        return Array.from(
            document.querySelectorAll(
                'nav.panel-tabs'
            )
        ).find(
            nav =>
                nav.getAttribute(
                    'aria-label'
                ) ===
                'Account sections'
        ) || null;
    }

    function closeCarlSettings() {
        document
            .querySelectorAll(
                '.tf-carl-native-hidden'
            )
            .forEach(
                element => {
                    element.classList.remove(
                        'tf-carl-native-hidden'
                    );
                }
            );

        document
            .getElementById(
                'tf-carl-settings-section'
            )
            ?.remove();

        document
            .getElementById(
                'tf-carl-settings-tab'
            )
            ?.classList.remove(
                'panel-tab--active'
            );
    }

    function injectCarlSettingsTab() {
        const nav =
            getAccountNav();

        if (!nav) {
            return;
        }

        let button =
            nav.querySelector(
                '#tf-carl-settings-tab'
            );

        if (!button) {
            button =
                document.createElement(
                    'button'
                );

            button.id =
                'tf-carl-settings-tab';

            button.className =
                'panel-tab';

            button.textContent =
                "First Mate's Settings";

            const referrals =
                Array.from(
                    nav.querySelectorAll(
                        '.panel-tab'
                    )
                ).find(
                    tab =>
                        tab.textContent
                            .trim() ===
                        'Referrals'
                );

            if (referrals) {
                nav.insertBefore(
                    button,
                    referrals
                );
            } else {
                nav.appendChild(
                    button
                );
            }

            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();
                    event.stopPropagation();

                    Array.from(
                        nav.parentElement
                            ?.children ||
                        []
                    )
                        .filter(
                            element =>
                                element !==
                                    nav &&
                                element.id !==
                                    'tf-carl-settings-section'
                        )
                        .forEach(
                            element => {
                                element.classList.add(
                                    'tf-carl-native-hidden'
                                );
                            }
                        );

                    nav.querySelectorAll(
                        '.panel-tab'
                    ).forEach(
                        tab => {
                            tab.classList.remove(
                                'panel-tab--active'
                            );
                        }
                    );

                    button.classList.add(
                        'panel-tab--active'
                    );

                    let section =
                        document.getElementById(
                            'tf-carl-settings-section'
                        );

                    if (!section) {
                        section =
                            buildCarlSettingsSection();

                        nav.insertAdjacentElement(
                            'afterend',
                            section
                        );
                    }

                    refreshSettingsUI();
                }
            );
        }

        nav.querySelectorAll(
            '.panel-tab'
        ).forEach(
            tab => {

                if (
                    tab.id ===
                    'tf-carl-settings-tab'
                ) {
                    return;
                }

                if (
                    tab.dataset
                        .carlBound ===
                    '1'
                ) {
                    return;
                }

                tab.dataset
                    .carlBound =
                    '1';

                tab.addEventListener(
                    'click',
                    closeCarlSettings,
                    true
                );
            }
        );
    }

    // =========================================================
    // SETTINGS CHANGES
    // =========================================================

    function handleSettingsChanged() {
        if (
            !settings
                .combatTrackerEnabled
        ) {
            combatRunning =
                false;

            combatPanel.style.display =
                'none';
        }

        if (
            !settings
                .combatWarningsEnabled
        ) {
            combatWarning.style.display =
                'none';
        }

        if (
            !settings
                .idleWarningEnabled
        ) {
            idleSince =
                null;

            idleWarning.style.display =
                'none';
        }

        if (
            !settings
                .activityTrackerEnabled
        ) {
            resetActivitySession(
                true
            );
        }

        if (
            !settings
                .cannonDurabilityEnabled
        ) {
            document
                .querySelectorAll(
                    '.tf-cannon-durability'
                )
                .forEach(
                    label =>
                        label.remove()
                );

            lastCannonLayoutSignature =
                '';
        } else {
            refreshCannonDurabilityDisplay();
        }

        checkCombatWarnings();

        updateCombatDisplay();

        updateActivityDisplay();
    }

    // =========================================================
    // ACTIVITY PANEL POSITION
    // =========================================================

    function saveActivityPanelPosition() {
        const rect =
            activityPanel
                .getBoundingClientRect();

        try {
            localStorage.setItem(
                ACTIVITY_POSITION_KEY,
                JSON.stringify({
                    left:
                        Math.round(
                            rect.left
                        ),

                    top:
                        Math.round(
                            rect.top
                        )
                })
            );
        } catch (error) {
            console.warn(
                '[Carl Tools] Could not save activity panel position:',
                error
            );
        }
    }

    function restoreActivityPanelPosition() {
        try {
            const saved =
                JSON.parse(
                    localStorage.getItem(
                        ACTIVITY_POSITION_KEY
                    ) || 'null'
                );

            if (
                !saved ||
                !Number.isFinite(
                    saved.left
                ) ||
                !Number.isFinite(
                    saved.top
                )
            ) {
                return;
            }

            const maxLeft =
                Math.max(
                    0,
                    window.innerWidth -
                        270
                );

            const maxTop =
                Math.max(
                    0,
                    window.innerHeight -
                        80
                );

            const left =
                Math.max(
                    0,
                    Math.min(
                        saved.left,
                        maxLeft
                    )
                );

            const top =
                Math.max(
                    0,
                    Math.min(
                        saved.top,
                        maxTop
                    )
                );

            activityPanel.style.right =
                'auto';

            activityPanel.style.left =
                `${left}px`;

            activityPanel.style.top =
                `${top}px`;
        } catch (error) {
            console.warn(
                '[Carl Tools] Could not restore activity panel position:',
                error
            );
        }
    }

    // =========================================================
    // DRAGGING
    // =========================================================

    function makePanelDraggable(
        panel,
        header,
        rightAnchored = false
    ) {
        let dragging =
            false;

        let offsetX =
            0;

        let offsetY =
            0;

        header.addEventListener(
            'mousedown',
            event => {

                if (
                    event.target.closest(
                        'button'
                    )
                ) {
                    return;
                }

                dragging =
                    true;

                const rect =
                    panel
                        .getBoundingClientRect();

                offsetX =
                    event.clientX -
                    rect.left;

                offsetY =
                    event.clientY -
                    rect.top;

                if (rightAnchored) {
                    panel.style.right =
                        'auto';

                    panel.style.left =
                        `${rect.left}px`;
                }
            }
        );

        document.addEventListener(
            'mousemove',
            event => {

                if (!dragging) {
                    return;
                }

                panel.style.left =
                    `${Math.max(
                        0,
                        Math.min(
                            event.clientX -
                                offsetX,
                            window.innerWidth -
                                panel.offsetWidth
                        )
                    )}px`;

                panel.style.top =
                    `${Math.max(
                        0,
                        Math.min(
                            event.clientY -
                                offsetY,
                            window.innerHeight -
                                panel.offsetHeight
                        )
                    )}px`;
            }
        );

        document.addEventListener(
            'mouseup',
            () => {
                if (!dragging) {
                    return;
                }

                dragging =
                    false;

                if (
                    panel ===
                    activityPanel
                ) {
                    saveActivityPanelPosition();
                }
            }
        );
    }

    makePanelDraggable(
        combatPanel,
        combatHeader
    );

    makePanelDraggable(
        activityPanel,
        activityHeader,
        true
    );

    // =========================================================
    // OBSERVERS
    // =========================================================

    const accountObserver =
        new MutationObserver(
            injectCarlSettingsTab
        );

    accountObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

    const combatObserver =
        new MutationObserver(
            scanVictories
        );

    combatObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true,
            characterData: true
        }
    );

    // =========================================================
    // TIMERS
    // =========================================================

    setInterval(
        scanVictories,
        COMBAT_SCAN_INTERVAL
    );

    setInterval(
        scanItemConsumption,
        ITEM_SCAN_INTERVAL
    );

    setInterval(
        scanMarketPrices,
        MARKET_SCAN_INTERVAL
    );

    setInterval(
        updateCombatDisplay,
        DISPLAY_INTERVAL
    );

    setInterval(
        checkCombatWarnings,
        WARNING_SCAN_INTERVAL
    );

    setInterval(
        checkIdleWarning,
        WARNING_SCAN_INTERVAL
    );

    setInterval(
        scanActivity,
        ACTIVITY_SCAN_INTERVAL
    );

    setInterval(
        checkForNewCannonLayout,
        1000
    );

    setInterval(
        () => {
            void applyStartupDisplayAndCamera();

    checkNavigationFollowShip();
        },
        500
    );

    setInterval(
        checkNavigationFollowShip,
        250
    );

    setInterval(
        () =>
            scanCannonDurability(true),
        CANNON_DURABILITY_SCAN_INTERVAL
    );

    // =========================================================
    // INITIALIZE
    // =========================================================

    restoreActivityPanelPosition();

    injectCarlSettingsTab();

    scanMarketPrices();

    updateCombatDisplay();

    updateCombatButton();

    updateActivityDisplay();

    handleSettingsChanged();

    checkIdleWarning();


    checkForNewCannonLayout();

    void applyStartupDisplayAndCamera();
})();
