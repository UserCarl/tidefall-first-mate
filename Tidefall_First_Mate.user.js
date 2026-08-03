// ==UserScript==
// @name         Tidefall First Mate
// @namespace    tidefall-first-mate
// @version      1.8
// @description  Combat tracker, combat warnings, activity tracker, mastery-aware item rates, market pricing, and First Mate's Settings
// @icon         https://www.google.com/s2/favicons?sz=64&domain=playtidefall.com
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

    const SETTINGS_STORAGE_KEY = 'tf-firstmate-settings-v2';
    const PRICE_STORAGE_KEY = 'tf-pve-market-prices-v2';
    const ACTIVITY_POSITION_KEY = 'tf-activity-panel-position-v1';
    const ACTIVITY_HISTORY_KEY = 'tf-activity-history-v1';
    const QUEUE_DEBUG_POSITION_KEY = 'tf-queue-debug-position-v1';
    const QUEUE_DEBUG_STATE_KEY = 'tf-queue-debug-state-v1';
    const DEVELOPER_TOOLS_SECTION_KEY = 'tf-developer-tools-section-open-v1';

    const FIRST_MATE_VERSION = '1.8';
    const FIRST_MATE_GITHUB_URL =
        'https://github.com/UserCarl/tidefall-first-mate';

    const DEFAULT_SETTINGS = {
        combatTrackerEnabled: true,
        consumableCostsEnabled: true,
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
        activitySessionLayout: 'header',
        combatSessionLayout: 'header',
        pveTrackerHideDelaySeconds: 30,
        activityQueueRemaining: true,
        queueDebuggerEnabled: false,

        skillProgressPercentEnabled: false,



        startupFollowShipEnabled: false
    };

    function loadSettings() {
        try {
            const oldSettings = JSON.parse(
                localStorage.getItem('tf-firstmate-settings-v1') || '{}'
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
                '[FirstMate Tools] Could not save settings:',
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
                '[FirstMate Tools] Could not save activity history:',
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

        /*
         * Keep history separate for every recipe. A node can host
         * several activities with different XP and cycle times, so
         * using the node ID by itself blends unrelated recipes and
         * produces incorrect time-to-level estimates.
         */
        const normalizedSkill =
            normalizeActivityKeyPart(skill);

        const normalizedTask =
            normalizeActivityKeyPart(taskName);

        if (nodeId) {
            return (
                `taskv2:node:${normalizeActivityKeyPart(nodeId)}:` +
                `${normalizedSkill}:${normalizedTask}`
            );
        }

        return (
            `taskv2:${normalizedSkill}:` +
            normalizedTask
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
    const PORT_ITEM_DECREASE_CONFIRM_MS = 3000;
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


    /*
     * Base activity data supplied by the Tidefall profession table.
     * Exact observed values always take priority because city bonuses,
     * mastery XP, and other modifiers can change the displayed result.
     */
    const BASE_ACTIVITY_RECIPES = {
        pine_log: { skill: 'logging', xp: 2, seconds: 6 },
        oak_log: { skill: 'logging', xp: 5, seconds: 10 },
        willow_log: { skill: 'logging', xp: 8, seconds: 14 },
        maple_log: { skill: 'logging', xp: 12, seconds: 18 },
        teak_log: { skill: 'logging', xp: 18, seconds: 22 },
        mahogany_log: { skill: 'logging', xp: 25, seconds: 30 },
        yew_log: { skill: 'logging', xp: 32, seconds: 38 },
        blackwood_log: { skill: 'logging', xp: 40, seconds: 46 },
        ironbark_log: { skill: 'logging', xp: 50, seconds: 52 },
        elderwood_log: { skill: 'logging', xp: 60, seconds: 60 },

        copper_ore: { skill: 'mining', xp: 2, seconds: 8 },
        iron_ore: { skill: 'mining', xp: 5, seconds: 15 },
        cinder_ore: { skill: 'mining', xp: 10, seconds: 23 },
        darkiron_ore: { skill: 'mining', xp: 15, seconds: 27 },
        mithril_ore: { skill: 'mining', xp: 21, seconds: 31 },
        adamantite_ore: { skill: 'mining', xp: 27, seconds: 36 },
        starmetal_ore: { skill: 'mining', xp: 35, seconds: 40 },
        stormglass_ore: { skill: 'mining', xp: 42, seconds: 44 },
        leviathan_ore: { skill: 'mining', xp: 49, seconds: 50 },
        abyssal_ore: { skill: 'mining', xp: 60, seconds: 60 },

        mackerel: { skill: 'fishing', xp: 2, seconds: 7 },
        sardine: { skill: 'fishing', xp: 6, seconds: 12 },
        cod: { skill: 'fishing', xp: 8, seconds: 14 },
        salmon: { skill: 'fishing', xp: 13, seconds: 18 },
        tuna: { skill: 'fishing', xp: 16, seconds: 21 },
        swordfish: { skill: 'fishing', xp: 22, seconds: 27 },
        shark: { skill: 'fishing', xp: 27, seconds: 31 },
        deepfin_tuna: { skill: 'fishing', xp: 35, seconds: 40 },
        stormray: { skill: 'fishing', xp: 40, seconds: 41 },
        dreadwhale: { skill: 'fishing', xp: 55, seconds: 45 },

        pine_plank: { skill: 'carpentry', xp: 2, seconds: 6 },
        pine_beam: { skill: 'carpentry', xp: 4, seconds: 12 },
        oak_plank: { skill: 'carpentry', xp: 5, seconds: 10 },
        oak_beam: { skill: 'carpentry', xp: 10, seconds: 20 },
        willow_plank: { skill: 'carpentry', xp: 8, seconds: 14 },
        willow_beam: { skill: 'carpentry', xp: 16, seconds: 28 },
        maple_plank: { skill: 'carpentry', xp: 12, seconds: 18 },
        maple_beam: { skill: 'carpentry', xp: 24, seconds: 36 },
        teak_plank: { skill: 'carpentry', xp: 18, seconds: 22 },
        teak_beam: { skill: 'carpentry', xp: 36, seconds: 44 },
        mahogany_plank: { skill: 'carpentry', xp: 25, seconds: 30 },
        mahogany_beam: { skill: 'carpentry', xp: 50, seconds: 60 },
        yew_plank: { skill: 'carpentry', xp: 32, seconds: 38 },
        yew_beam: { skill: 'carpentry', xp: 64, seconds: 76 },
        blackwood_plank: { skill: 'carpentry', xp: 40, seconds: 46 },
        blackwood_beam: { skill: 'carpentry', xp: 80, seconds: 92 },
        ironbark_plank: { skill: 'carpentry', xp: 50, seconds: 52 },
        ironbark_beam: { skill: 'carpentry', xp: 100, seconds: 104 },
        elderwood_plank: { skill: 'carpentry', xp: 60, seconds: 60 },
        elderwood_beam: { skill: 'carpentry', xp: 120, seconds: 120 },

        copper_bar: { skill: 'smelting', xp: 2, seconds: 8 },
        iron_bar: { skill: 'smelting', xp: 6, seconds: 15 },
        cinder_bar: { skill: 'smelting', xp: 10, seconds: 23 },
        darkiron_bar: { skill: 'smelting', xp: 14, seconds: 27 },
        mithril_bar: { skill: 'smelting', xp: 22, seconds: 31 },
        adamantite_bar: { skill: 'smelting', xp: 30, seconds: 36 },
        starmetal_bar: { skill: 'smelting', xp: 38, seconds: 40 },
        stormglass_bar: { skill: 'smelting', xp: 48, seconds: 44 },
        leviathan_bar: { skill: 'smelting', xp: 58, seconds: 50 },
        abyssal_bar: { skill: 'smelting', xp: 72, seconds: 60 },

        salted_mackerel: { skill: 'cooking', xp: 7, seconds: 5 },
        dried_sardines: { skill: 'cooking', xp: 12, seconds: 6 },
        cod_stew: { skill: 'cooking', xp: 25, seconds: 10 },
        grilled_salmon: { skill: 'cooking', xp: 45, seconds: 15 },
        tuna_rations: { skill: 'cooking', xp: 65, seconds: 18 },
        swordfish_cuts: { skill: 'cooking', xp: 90, seconds: 22 },
        shark_haunch: { skill: 'cooking', xp: 130, seconds: 28 },
        deepfin_steaks: { skill: 'cooking', xp: 185, seconds: 35 },
        stormray_fillet: { skill: 'cooking', xp: 240, seconds: 45 },
        dreadwhale_feast: { skill: 'cooking', xp: 320, seconds: 60 },

        copper_nails: { skill: 'crafting', xp: 2, seconds: 4 },
        patch_kit: { skill: 'crafting', xp: 2, seconds: 10 },
        iron_nails: { skill: 'crafting', xp: 6, seconds: 5 },
        caulking_kit: { skill: 'crafting', xp: 6, seconds: 14 },
        cinder_nails: { skill: 'crafting', xp: 10, seconds: 6 },
        hull_repair_kit: { skill: 'crafting', xp: 10, seconds: 18 },
        darkiron_nails: { skill: 'crafting', xp: 14, seconds: 8 },
        deck_repair_kit: { skill: 'crafting', xp: 14, seconds: 22 },
        mithril_nails: { skill: 'crafting', xp: 20, seconds: 10 },
        reinforcement_kit: { skill: 'crafting', xp: 22, seconds: 28 },
        adamantite_nails: { skill: 'crafting', xp: 26, seconds: 12 },
        shipwright_kit: { skill: 'crafting', xp: 30, seconds: 34 },
        starmetal_nails: { skill: 'crafting', xp: 32, seconds: 15 },
        master_repair_kit: { skill: 'crafting', xp: 38, seconds: 42 },
        stormglass_nails: { skill: 'crafting', xp: 38, seconds: 18 },
        hull_restoration_kit: { skill: 'crafting', xp: 48, seconds: 50 },
        leviathan_nails: { skill: 'crafting', xp: 48, seconds: 25 },
        refit_crate: { skill: 'crafting', xp: 58, seconds: 58 },
        abyssal_nails: { skill: 'crafting', xp: 60, seconds: 35 },
        master_refit_crate: { skill: 'crafting', xp: 72, seconds: 70 }
    };

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

        .tf-firstmate-refresh-button {
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

        .tf-firstmate-refresh-button:hover {
            background:
                #c5a0592e;

            border-color:
                #c5a05999;
        }


        .tf-firstmate-version-card {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 18px;
        }

        .tf-firstmate-version-value {
            color:
                var(--gold, #c5a059);

            font-family:
                var(--font-heading, "QuadraatOffcPro", Georgia, serif);

            font-size:
                var(--font-size-lg, 1.3rem);

            font-weight: 700;

            letter-spacing: .08em;
        }

        .tf-firstmate-github-button {
            padding: 9px 12px;

            cursor: pointer;

            color:
                var(--gold, #c5a059);

            background:
                #c5a05914;

            border:
                1px solid #c5a05959;

            border-radius:
                var(--radius-sm);

            font-family:
                var(--font-body);

            font-size:
                var(--font-size-sm);

            font-weight: 700;

            letter-spacing: .06em;
            text-transform: uppercase;
        }

        .tf-firstmate-github-button:hover {
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

        #tf-net-gold-row {
            cursor: pointer;
        }

        #tf-net-gold-row:hover {
            background: rgba(197, 160, 89, .06);
        }

        #tf-net-gold-open {
            margin-left: 5px;
            color: var(--gold, #c5a059);
            font-size: .8em;
        }

        #tf-cost-window {
            top: 130px;
            left: 50%;
            transform: translateX(-50%);
            width: 300px;
            display: none;
        }

        #tf-cost-window.tf-open {
            display: block;
        }

        #tf-cost-window-body {
            padding: 12px 16px 16px;
        }

        .tf-cost-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 12px;
            padding: 6px 0;
            border-bottom: 1px solid rgba(255, 255, 255, .05);
            color: var(--text-secondary, #d4be8ca6);
            font-size: var(--font-size-sm, .909rem);
        }

        .tf-cost-row strong {
            color: var(--text-primary, #e8e0d0);
            font-weight: 600;
        }

        .tf-cost-row.tf-positive strong {
            color: var(--reward-gold, #f0c45c);
        }

        .tf-cost-row.tf-negative strong {
            color: var(--text-danger, #e86b60);
        }

        .tf-cost-row.tf-total {
            margin-top: 5px;
            padding-top: 8px;
            border-top: 1px solid rgba(197, 160, 89, .28);
            border-bottom: 0;
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

        .tf-community-warning-brand {
            margin-bottom: 10px;
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, "QuadraatOffcPro", Georgia, serif);
            font-size: 14px;
            font-weight: 700;
            letter-spacing: .04em;
            line-height: 1.2;
            text-transform: none;
        }

        .tf-community-warning-title {
            color: #ff3b30;
            font-family: var(--font-heading, "QuadraatOffcPro", Georgia, serif);
            font-size: 22px;
            font-weight: 900;
            letter-spacing: .06em;
            line-height: 1.2;
            text-transform: uppercase;
        }

        .tf-community-warning-message {
            margin-top: 6px;
            color: var(--text-primary, #e8e0d0);
            font-family: var(--font-body, "Gothic A1", sans-serif);
            font-size: 15px;
            font-weight: 600;
            letter-spacing: 0;
            line-height: 1.35;
            text-transform: none;
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

        .pp-skill-bottom {
            position: relative;
        }

        .tf-skill-progress-percent {
            margin-left: auto;
            padding-left: 8px;

            color:
                var(--reward-xp, #aee67a);

            font-family:
                var(--font-body, "Gothic A1", sans-serif);

            font-size: 11px;
            font-weight: 800;
            line-height: 1;

            white-space: nowrap;
            text-shadow:
                0 1px 2px #000000;

            pointer-events: none;
            user-select: none;
        }

        .tf-firstmate-collapsible-group {
            margin: 0 0 22px;
            border: 1px solid rgba(197, 160, 89, .24);
            border-radius: var(--radius-sm, .364rem);
            overflow: hidden;
            background: rgba(0, 0, 0, .10);
        }

        .tf-firstmate-collapsible-heading {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 12px 14px;
            cursor: pointer;
            color: var(--gold, #c5a059);
            background: rgba(0, 0, 0, .14);
            border: 0;
            font-family: var(--font-heading, "QuadraatOffcPro", Georgia, serif);
            font-size: var(--font-size-sm, .909rem);
            font-weight: 700;
            letter-spacing: .06em;
            text-align: left;
            text-transform: uppercase;
        }

        .tf-firstmate-collapsible-heading:hover {
            background: rgba(197, 160, 89, .06);
        }

        .tf-firstmate-collapsible-arrow {
            width: 10px;
            flex: 0 0 10px;
            font-family: Arial, sans-serif;
            font-size: 10px;
            line-height: 1;
        }

        .tf-firstmate-collapsible-content {
            padding: 12px;
        }

        .tf-firstmate-collapsible-group.tf-collapsed
        .tf-firstmate-collapsible-content {
            display: none;
        }

        .tf-firstmate-settings-group {
            margin-bottom: 22px;
        }

        .tf-firstmate-settings-group:last-child {
            margin-bottom: 0;
        }

        .tf-firstmate-settings-group-title {
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

        #tf-firstmate-settings-section {
            width: 100%;
        }

        .tf-firstmate-native-hidden {
            display: none !important;
        }

        .tf-firstmate-toggle-row,
        .tf-firstmate-threshold-row,
        .tf-firstmate-select-row {
            display: flex;

            align-items: center;
            justify-content: space-between;

            gap: 20px;

            width: 100%;
        }

        .tf-firstmate-threshold-row,
        .tf-firstmate-select-row {
            margin-top: 12px;
        }

        .tf-firstmate-setting-label {
            color:
                var(--text-primary);
        }

        .tf-firstmate-toggle {
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

        .tf-firstmate-toggle::after {
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

        .tf-firstmate-toggle.tf-enabled {
            background:
                #c5a05933;

            border-color:
                #c5a05999;
        }

        .tf-firstmate-toggle.tf-enabled::after {
            left: 23px;

            background:
                var(--gold);
        }

        .tf-firstmate-number-wrap {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .tf-firstmate-slider-wrap {
            display: grid;
            grid-template-columns: 220px 52px;
            align-items: center;
            column-gap: 10px;
            min-width: 282px;
        }

        .tf-firstmate-slider {
            width: 220px;
            cursor: pointer;
        }

        .tf-firstmate-slider-value {
            min-width: 52px;
            color: var(--text-primary);
            font-weight: 700;
            text-align: right;
        }

        .tf-firstmate-number,
        .tf-firstmate-select {
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

        .tf-firstmate-number {
            width: 82px;

            text-align: right;
        }

        .tf-firstmate-select {
            min-width: 180px;

            cursor: pointer;

            color-scheme: dark;

            color: #ffffff;

            background:
                #181a1f;

            border-color:
                #8d6a2f;
        }

        .tf-firstmate-select option {
            color: #ffffff;

            background:
                #181a1f;
        }

        .tf-firstmate-number:focus,
        .tf-firstmate-select:focus {
            outline: none;

            border-color:
                #c5a05999;
        }

        .tf-firstmate-unit {
            min-width: 42px;

            color:
                var(--text-secondary);
        }

        .tf-firstmate-disabled {
            opacity: .35;

            pointer-events: none;
        }

        .tf-firstmate-card-dependent-disabled {
            opacity: .35;
        }

        #tf-activity-header-layout {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);

            z-index: 5;

            display: none;
            align-items: center;
            justify-content: center;

            gap: 10px;

            height: 40px;
            max-width: calc(100% - 760px);

            padding: 0 10px;

            color: var(--text-primary, #e8e0d0);
            font-family: var(--font-body, "Gothic A1", sans-serif);

            white-space: nowrap;
            pointer-events: none;
        }

        #tf-activity-header-layout.tf-active {
            display: flex;
        }

        .tf-activity-header-title {
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, "QuadraatOffcPro", Georgia, serif);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
            opacity: .9;
        }

        .tf-activity-header-stat {
            display: flex;
            align-items: baseline;
            gap: 4px;

            padding-left: 9px;

            border-left:
                1px solid rgba(197, 160, 89, .18);
        }

        .tf-activity-header-label {
            color: var(--text-secondary, #d4be8ca6);
            font-size: 9px;
            letter-spacing: .05em;
            text-transform: uppercase;
        }

        .tf-activity-header-value {
            color: var(--reward-xp, #aee67a);
            font-size: 11px;
            font-weight: 700;
        }

        .tf-activity-header-stat[data-kind="queue"] .tf-activity-header-value,
        .tf-activity-header-stat[data-kind="elapsed"] .tf-activity-header-value {
            color: var(--text-primary, #e8e0d0);
        }

        .tf-activity-header-task {
            max-width: 180px;

            overflow: hidden;
            text-overflow: ellipsis;

            color: var(--text-secondary, #d4be8ca6);

            font-size: 10px;
        }

        #tf-queue-debug {
            position: fixed;
            left: 12px;
            bottom: 12px;
            z-index: 10000001;
            width: 430px;
            min-width: 300px;
            min-height: 120px;
            max-width: calc(100vw - 24px);
            max-height: 70vh;
            overflow: hidden;
            resize: both;
            color: #e8e0d0;
            background: rgba(5, 7, 10, .96);
            border: 1px solid rgba(197, 160, 89, .75);
            border-radius: 6px;
            box-shadow: 0 4px 18px rgba(0, 0, 0, .6);
            font: 12px/1.45 monospace;
            pointer-events: auto;
            user-select: text;
        }

        #tf-queue-debug-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            cursor: move;
            border-bottom: 1px solid rgba(197, 160, 89, .28);
            background: rgba(18, 20, 23, .98);
            user-select: none;
        }

        #tf-queue-debug-title {
            flex: 1;
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tf-queue-debug-btn {
            padding: 3px 7px;
            cursor: pointer;
            color: #e8e0d0;
            background: rgba(255,255,255,.05);
            border: 1px solid rgba(197,160,89,.35);
            border-radius: 4px;
            font: 11px/1.2 monospace;
        }

        .tf-queue-debug-btn:hover {
            border-color: rgba(197,160,89,.8);
        }

        #tf-queue-debug-content {
            height: calc(100% - 39px);
            overflow: auto;
            padding: 10px 12px;
            white-space: pre-wrap;
        }

        #tf-queue-debug.tf-minimized {
            height: auto !important;
            min-height: 0;
            resize: none;
        }

        #tf-queue-debug.tf-minimized #tf-queue-debug-content {
            display: none;
        }


        #tf-combat-header-layout {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 6;

            display: none;
            align-items: center;
            justify-content: center;
            gap: 10px;

            height: 40px;
            max-width: calc(100% - 760px);
            padding: 0 10px;

            color: var(--text-primary, #e8e0d0);
            font-family: var(--font-body, "Gothic A1", sans-serif);
            white-space: nowrap;
            pointer-events: none;
        }

        #tf-combat-header-layout.tf-active {
            display: flex;
        }

        .tf-combat-header-title {
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, "QuadraatOffcPro", Georgia, serif);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tf-combat-header-stat {
            display: flex;
            align-items: baseline;
            gap: 4px;
            padding-left: 9px;
            border-left: 1px solid rgba(197, 160, 89, .18);
        }

        .tf-combat-header-label {
            color: var(--text-secondary, #d4be8ca6);
            font-size: 9px;
            letter-spacing: .05em;
            text-transform: uppercase;
        }

        .tf-combat-header-value {
            color: var(--reward-xp, #aee67a);
            font-size: 11px;
            font-weight: 700;
        }

        .tf-combat-header-stat[data-kind="kills"] .tf-combat-header-value {
            color: var(--combat-victory, #e0c36a);
        }

        .tf-combat-header-stat[data-kind="gold"] .tf-combat-header-value {
            color: var(--reward-gold, #f0c45c);
        }


        .tf-combat-header-stat[data-kind="gold"] {
            pointer-events: auto;
            cursor: pointer;
        }

        @media (max-width: 1700px) {
            #tf-activity-header-layout {
                max-width: calc(100% - 650px);
                gap: 7px;
            }

            .tf-activity-header-task {
                display: none;
            }
        }

        @media (max-width: 1450px) {
            .tf-activity-header-stat[data-kind="elapsed"] {
                display: none;
            }
        }

        @media (max-width: 1300px) {
            .tf-activity-header-title {
                display: none;
            }
        }

        @media (max-width: 1150px) {
            .tf-activity-header-stat[data-kind="items"] {
                display: none;
            }
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

    idleWarning.innerHTML = `
        <div class="tf-community-warning-brand">
            ⚓ Tidefall First Mate - Community Addon
        </div>

        <div
            id="tf-idle-warning-title"
            class="tf-community-warning-title"
        >
            Idle Warning
        </div>

        <div
            id="tf-idle-warning-message"
            class="tf-community-warning-message"
        >
            No active task detected.
        </div>
    `;

    document.body.appendChild(
        idleWarning
    );

    const idleWarningTitle =
        idleWarning.querySelector(
            '#tf-idle-warning-title'
        );

    const idleWarningMessage =
        idleWarning.querySelector(
            '#tf-idle-warning-message'
        );

    const combatWarning =
        document.createElement('div');

    combatWarning.id =
        'tf-combat-warning';

    combatWarning.innerHTML = `
        <div class="tf-community-warning-brand">
            ⚓ Tidefall First Mate - Community Addon
        </div>

        <div id="tf-combat-warning-content"></div>
    `;

    document.body.appendChild(
        combatWarning
    );

    const combatWarningContent =
        combatWarning.querySelector(
            '#tf-combat-warning-content'
        );

    const priceWarning =
        document.createElement('div');

    priceWarning.id =
        'tf-price-warning';

    priceWarning.innerHTML = `
        <div class="tf-community-warning-brand">
            ⚓ Tidefall First Mate - Community Addon
        </div>

        <div
            id="tf-price-warning-title"
            class="tf-community-warning-title"
        >
            Price Missing
        </div>

        <div
            id="tf-price-warning-message"
            class="tf-community-warning-message"
        >
            Open Exchange to load item price.
        </div>
    `;

    document.body.appendChild(
        priceWarning
    );

    const priceWarningTitle =
        priceWarning.querySelector(
            '#tf-price-warning-title'
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

            <div
                id="tf-net-gold-row"
                class="tf-stat-row"
                role="button"
                tabindex="0"
                aria-label="Open PvE cost breakdown"
            >
                <span class="tf-stat-label">
                    Net Gold
                </span>

                <span
                    id="tf-net-gold"
                    class="tf-stat-value"
                >
                    0
                    <span id="tf-net-gold-open">↗</span>
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


    const netGoldRow =
        combatPanel.querySelector(
            '#tf-net-gold-row'
        );

    const costWindow =
        document.createElement(
            'div'
        );

    costWindow.id =
        'tf-cost-window';

    costWindow.className =
        'tf-session-panel';

    costWindow.innerHTML = `
        <div
            id="tf-cost-window-header"
            class="tf-session-header"
        >
            <div class="tf-session-title">
                PvE Cost Breakdown
            </div>

            <button
                id="tf-cost-window-close"
                class="tf-window-btn"
                type="button"
                title="Close"
            >
                ×
            </button>
        </div>

        <div id="tf-cost-window-body">
            <div class="tf-cost-row tf-positive">
                <span>Gold Earned</span>
                <strong id="tf-cost-gross">+0</strong>
            </div>

            <div class="tf-cost-row tf-negative">
                <span>Ammo Cost</span>
                <strong id="tf-cost-ammo">-0</strong>
            </div>

            <div class="tf-cost-row tf-negative">
                <span>Food Cost</span>
                <strong id="tf-cost-food">-0</strong>
            </div>

            <div class="tf-cost-row tf-negative">
                <span>Repair Kits</span>
                <strong id="tf-cost-repairs">-0</strong>
            </div>

            <div class="tf-cost-row tf-total">
                <span>Net Gold</span>
                <strong id="tf-cost-net">0</strong>
            </div>
        </div>
    `;

    document.body.appendChild(
        costWindow
    );

    const costWindowHeader =
        costWindow.querySelector(
            '#tf-cost-window-header'
        );

    const costWindowClose =
        costWindow.querySelector(
            '#tf-cost-window-close'
        );

    const costGrossElement =
        costWindow.querySelector(
            '#tf-cost-gross'
        );

    const costAmmoElement =
        costWindow.querySelector(
            '#tf-cost-ammo'
        );

    const costFoodElement =
        costWindow.querySelector(
            '#tf-cost-food'
        );

    const costRepairsElement =
        costWindow.querySelector(
            '#tf-cost-repairs'
        );

    const costNetElement =
        costWindow.querySelector(
            '#tf-cost-net'
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

            <div
                id="tf-activity-queue-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">
                    Queue Remaining
                </span>

                <span
                    id="tf-activity-queue-remaining"
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

    const queueDebugPanel =
        document.createElement('div');

    queueDebugPanel.id =
        'tf-queue-debug';

    queueDebugPanel.innerHTML = `
        <div id="tf-queue-debug-header">
            <div id="tf-queue-debug-title">Developer Tools</div>
            <button id="tf-queue-debug-pause" class="tf-queue-debug-btn" type="button">Pause</button>
            <button id="tf-queue-debug-copy" class="tf-queue-debug-btn" type="button">Copy</button>
            <button id="tf-queue-debug-minimize" class="tf-queue-debug-btn" type="button" title="Minimize">−</button>
            <button id="tf-queue-debug-close" class="tf-queue-debug-btn" type="button" title="Close">×</button>
        </div>
        <div id="tf-queue-debug-content">Waiting for an active queued activity...</div>
    `;

    document.body.appendChild(
        queueDebugPanel
    );

    const queueDebugContent =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-content'
        );

    const queueDebugHeader =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-header'
        );

    const queueDebugPauseButton =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-pause'
        );

    const queueDebugCopyButton =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-copy'
        );

    const queueDebugMinimizeButton =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-minimize'
        );

    const queueDebugCloseButton =
        queueDebugPanel.querySelector(
            '#tf-queue-debug-close'
        );

    let queueDebugPaused = false;
    let queueDebugMinimized = false;
    let queueDebugSessionClosed = false;
    let queueDebuggerLastEnabled =
        Boolean(settings.queueDebuggerEnabled);
    let queueDebugLastUpdateAt = 0;
    let queueDebugLatestText =
        'Waiting for an active queued activity...';

    function saveQueueDebugState() {
        try {
            localStorage.setItem(
                QUEUE_DEBUG_STATE_KEY,
                JSON.stringify({
                    minimized: queueDebugMinimized
                })
            );
        } catch {
            // Ignore developer-tool state failures.
        }
    }

    function restoreQueueDebugState() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(
                    QUEUE_DEBUG_STATE_KEY
                ) || 'null'
            );

            queueDebugMinimized =
                Boolean(saved?.minimized);

            queueDebugPanel.classList.toggle(
                'tf-minimized',
                queueDebugMinimized
            );

            queueDebugMinimizeButton.textContent =
                queueDebugMinimized
                    ? '+'
                    : '−';
        } catch {
            // Ignore malformed developer-tool state data.
        }
    }

    function updateQueueDebugVisibility() {
        queueDebugPanel.style.display =
            settings.queueDebuggerEnabled &&
            !queueDebugSessionClosed
                ? 'block'
                : 'none';
    }

    queueDebugPauseButton?.addEventListener(
        'click',
        () => {
            queueDebugPaused =
                !queueDebugPaused;

            queueDebugPauseButton.textContent =
                queueDebugPaused
                    ? 'Resume'
                    : 'Pause';
        }
    );

    queueDebugCopyButton?.addEventListener(
        'click',
        async () => {
            try {
                await navigator.clipboard.writeText(
                    queueDebugLatestText
                );

                queueDebugCopyButton.textContent =
                    'Copied';
            } catch {
                const textarea =
                    document.createElement('textarea');

                textarea.value =
                    queueDebugLatestText;

                document.body.appendChild(
                    textarea
                );

                textarea.select();
                document.execCommand('copy');
                textarea.remove();

                queueDebugCopyButton.textContent =
                    'Copied';
            }

            setTimeout(
                () => {
                    queueDebugCopyButton.textContent =
                        'Copy';
                },
                1200
            );
        }
    );

    queueDebugMinimizeButton?.addEventListener(
        'click',
        () => {
            queueDebugMinimized =
                !queueDebugMinimized;

            queueDebugPanel.classList.toggle(
                'tf-minimized',
                queueDebugMinimized
            );

            queueDebugMinimizeButton.textContent =
                queueDebugMinimized
                    ? '+'
                    : '−';

            saveQueueDebugState();
        }
    );

    queueDebugCloseButton?.addEventListener(
        'click',
        () => {
            queueDebugSessionClosed = true;
            updateQueueDebugVisibility();
        }
    );

    queueDebugPanel.style.display =
        'none';

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

    const activityQueueRow =
        activityPanel.querySelector(
            '#tf-activity-queue-row'
        );

    const activityQueueRemainingElement =
        activityPanel.querySelector(
            '#tf-activity-queue-remaining'
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

    /*
     * Tidefall can restore old combat-log entries after this
     * userscript has already started. Keep victory processing
     * locked briefly so restored history is marked as old rather
     * than counted as a new session.
     */
    let victoryTrackingReady =
        false;

    let victoryBaselineLastChangedAt =
        Date.now();

    const victoryBaselineStartedAt =
        Date.now();

    let victoryBaselineCount =
        0;

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
            !Number.isFinite(itemId) ||
            itemId <= 0 ||
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

    function shouldShowPvEHeader() {
        if (
            !combatRunning ||
            !settings.combatTrackerEnabled
        ) {
            return false;
        }

        if (
            isActuallyInCombat()
        ) {
            lastCombatTime =
                Date.now();

            return true;
        }

        const delay =
            Number(
                settings.pveTrackerHideDelaySeconds
            );

        if (delay === -1) {
            return (
                combatKills > 0 ||
                combatTotalXP > 0 ||
                combatGrossGold > 0
            );
        }

        if (
            lastCombatTime <= 0 ||
            !Number.isFinite(delay)
        ) {
            return false;
        }

        return (
            Date.now() -
                lastCombatTime <=
            Math.max(0, delay) * 1000
        );
    }

    function shouldPvEOccupySharedHeader() {
        if (
            settings.combatSessionLayout !==
                'header' ||
            !shouldShowPvEHeader()
        ) {
            return false;
        }

        /*
         * Combat always wins while a fight is actually active.
         */
        if (isActuallyInCombat()) {
            return true;
        }

        /*
         * After combat, an active non-combat task immediately
         * takes the shared header back. The PvE session remains
         * tracked in the background until its timer resets it,
         * or indefinitely when Hide After Combat is set to Never.
         */
        return !getCurrentActivity();
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
                    if (!seen.has(itemId)) {
                        warehouseQuantities.set(
                            itemId,
                            0
                        );
                    }
                }
            );
        }
    }

    function getTrackedGridQuantities(
        gridSelector
    ) {
        const quantities =
            new Map();

        document
            .querySelectorAll(
                `${gridSelector} [data-item-type]`
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

                    const quantity =
                        badge
                            ? numberFromText(
                                badge.textContent
                            )
                            : 1;

                    quantities.set(
                        itemId,
                        (
                            quantities.get(
                                itemId
                            ) || 0
                        ) +
                        quantity
                    );
                }
            );

        return quantities;
    }

    function getCombinedTrackedQuantities() {
        /*
         * While the port Inventory screen is open, read both
         * visible grids directly. This avoids mixing a live
         * warehouse count with the combat HUD's delayed ship
         * count during transfers.
         */
        const cargoGrid =
            document.querySelector(
                '#inv-cargo-grid'
            );

        const warehouseGrid =
            document.querySelector(
                '#inv-wh-grid'
            );

        if (
            cargoGrid &&
            warehouseGrid
        ) {
            const cargo =
                getTrackedGridQuantities(
                    '#inv-cargo-grid'
                );

            const warehouse =
                getTrackedGridQuantities(
                    '#inv-wh-grid'
                );

            const combined =
                new Map();

            TRACKED_IDS.forEach(
                itemId => {
                    combined.set(
                        itemId,
                        (
                            cargo.get(
                                itemId
                            ) || 0
                        ) +
                        (
                            warehouse.get(
                                itemId
                            ) || 0
                        )
                    );
                }
            );

            return combined;
        }

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
            idleWarningTitle.textContent =
                'Idle Warning';

            idleWarningMessage.textContent =
                `No active task detected for ${thresholdSeconds} seconds.`;

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
            warnings.push({
                key: 'LOW HULL',
                title: 'Low Hull Warning',
                message:
                    `Hull integrity below ${settings.hullWarningValue}%.`
            });
        }

        if (
            settings.crewWarningEnabled &&
            crew !== null &&
            crew <= settings.crewWarningValue
        ) {
            warnings.push({
                key: 'LOW CREW',
                title: 'Low Crew Warning',
                message:
                    `Crew strength below ${settings.crewWarningValue}%.`
            });
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
                warnings.push({
                    key: 'LOW AMMO',
                    title: 'Low Ammo Warning',
                    message:
                        `Ammunition at or below ${settings.ammoWarningValue} shots.`
                });
            }

            if (
                settings.foodWarningEnabled &&
                food !== null &&
                food <= settings.foodWarningValue
            ) {
                warnings.push({
                    key: 'LOW FOOD',
                    title: 'Low Food Warning',
                    message:
                        settings.foodWarningValue <= 0
                            ? 'No food remaining.'
                            : `Food at or below ${settings.foodWarningValue}.`
                });
            }

            if (
                settings.repairWarningEnabled &&
                repairs !== null &&
                repairs <= settings.repairWarningValue
            ) {
                warnings.push({
                    key: 'LOW REPAIR KITS',
                    title: 'Low Repair Kits Warning',
                    message:
                        settings.repairWarningValue <= 0
                            ? 'No repair kits remaining.'
                            : `Repair kits at or below ${settings.repairWarningValue}.`
                });
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
                    !warnings.some(
                        item =>
                            item.key === warning
                    )
                ) {
                    dismissedCombatWarnings.delete(
                        warning
                    );
                }
            }
        );

        currentCombatWarnings =
            warnings.map(
                warning => warning.key
            );

        const visibleWarnings =
            warnings.filter(
                warning =>
                    !dismissedCombatWarnings.has(
                        warning.key
                    )
            );

        if (
            visibleWarnings.length === 0
        ) {
            combatWarning.style.display =
                'none';
            return;
        }

        combatWarningContent.innerHTML =
            visibleWarnings
                .map(
                    warning => `
                        <div class="tf-community-warning-title">
                            ${warning.title}
                        </div>

                        <div class="tf-community-warning-message">
                            ${warning.message}
                        </div>
                    `
                )
                .join(
                    '<div style="height: 14px;"></div>'
                );

        combatWarning.style.display =
            'block';
    }

    // =========================================================
    // SKILL PROGRESS PERCENTAGE
    // =========================================================

    const skillProgressFillObservers =
        new Map();

    function getSkillProgressPercentFromFill(
        fill
    ) {
        if (!(fill instanceof HTMLElement)) {
            return null;
        }

        const inlineMatch =
            String(
                fill.style.width || ''
            ).match(
                /([0-9]+(?:\.[0-9]+)?)%/
            );

        if (!inlineMatch) {
            return null;
        }

        return Math.max(
            0,
            Math.min(
                100,
                Math.round(
                    Number(
                        inlineMatch[1]
                    )
                )
            )
        );
    }

    function updateSkillProgressLabel(
        fill
    ) {
        if (!(fill instanceof HTMLElement)) {
            return;
        }

        const card =
            fill.closest(
                '.pp-skill-card[data-skill]'
            );

        if (!(card instanceof HTMLElement)) {
            return;
        }

        const bottom =
            card.querySelector(
                '.pp-skill-bottom'
            );

        if (!(bottom instanceof HTMLElement)) {
            return;
        }

        let label =
            bottom.querySelector(
                ':scope > .tf-skill-progress-percent'
            );

        if (
            !settings.skillProgressPercentEnabled
        ) {
            label?.remove();
            return;
        }

        const percent =
            getSkillProgressPercentFromFill(
                fill
            );

        if (percent === null) {
            label?.remove();
            return;
        }

        if (!label) {
            label =
                document.createElement(
                    'div'
                );

            label.className =
                'tf-skill-progress-percent';

            bottom.appendChild(label);
        }

        const nextText =
            `${percent}%`;

        if (
            label.textContent !==
            nextText
        ) {
            label.textContent =
                nextText;
        }
    }

    function disconnectSkillProgressObservers() {
        skillProgressFillObservers
            .forEach(
                observer =>
                    observer.disconnect()
            );

        skillProgressFillObservers.clear();
    }

    function removeSkillProgressLabels() {
        document
            .querySelectorAll(
                '.tf-skill-progress-percent'
            )
            .forEach(
                label =>
                    label.remove()
            );
    }

    function bindSkillProgressBars() {
        if (
            !settings.skillProgressPercentEnabled
        ) {
            disconnectSkillProgressObservers();
            removeSkillProgressLabels();
            return;
        }

        const liveFills =
            new Set(
                document.querySelectorAll(
                    '.pp-skill-card[data-skill] .pp-skill-bar-fill'
                )
            );

        skillProgressFillObservers
            .forEach(
                (
                    observer,
                    fill
                ) => {
                    if (
                        !fill.isConnected ||
                        !liveFills.has(fill)
                    ) {
                        observer.disconnect();

                        skillProgressFillObservers.delete(
                            fill
                        );
                    }
                }
            );

        liveFills.forEach(
            fill => {
                updateSkillProgressLabel(
                    fill
                );

                if (
                    skillProgressFillObservers.has(
                        fill
                    )
                ) {
                    return;
                }

                const observer =
                    new MutationObserver(
                        () => {
                            updateSkillProgressLabel(
                                fill
                            );
                        }
                    );

                observer.observe(
                    fill,
                    {
                        attributes: true,
                        attributeFilter: [
                            'style'
                        ]
                    }
                );

                skillProgressFillObservers.set(
                    fill,
                    observer
                );
            }
        );
    }

    function updateSkillProgressPercentages() {
        bindSkillProgressBars();
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
                        !Number.isFinite(itemId) ||
                        itemId <= 0
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

    function isVisibleElement(
        element
    ) {
        if (!(element instanceof HTMLElement)) {
            return false;
        }

        const computed =
            window.getComputedStyle(
                element
            );

        return (
            !element.hidden &&
            computed.display !==
                'none' &&
            computed.visibility !==
                'hidden' &&
            Number(
                computed.opacity || 1
            ) !== 0 &&
            element.getClientRects()
                .length > 0
        );
    }

    function isExchangeOpen() {
        const candidates =
            [
                document.querySelector(
                    '#market-panel'
                ),
                document.querySelector(
                    '#mkt-tab-exchange'
                ),
                document.querySelector(
                    '.market-panel--open'
                )
            ];

        return candidates.some(
            isVisibleElement
        );
    }

    function isPortInventoryOpen() {
        const inventoryPanel =
            document.querySelector(
                '#inventory-panel'
            );

        if (!isVisibleElement(inventoryPanel)) {
            return false;
        }

        /*
         * Only pause for the port inventory view where both the
         * ship cargo and city warehouse grids are mounted.
         */
        return Boolean(
            inventoryPanel.querySelector(
                '#inv-cargo-grid'
            ) &&
            inventoryPanel.querySelector(
                '#inv-wh-grid'
            )
        );
    }

    // =========================================================
    // COMBAT CONSUMPTION
    // =========================================================

    function initializeItemTracking() {
        lastQuantities.clear();
        pendingItemDecreases.clear();

        const quantities =
            getEquippedConsumables();

        TRACKED_IDS.forEach(
            itemId => {
                const quantity =
                    quantities.get(
                        itemId
                    ) || 0;

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

        const inCombat =
            isActuallyInCombat();

        /*
         * Use only the ship's live combat HUD quantities for
         * consumable tracking. Port-storage totals and cached
         * warehouse quantities are intentionally excluded.
         */
        const quantities =
            getEquippedConsumables();

        /*
         * Outside combat, refresh the ship-only baseline without
         * charging any decreases. This prevents purchases,
         * transfers, and dockside item use from affecting the
         * PvE session while keeping the next fight's starting
         * quantities accurate.
         */
        if (!inCombat) {
            TRACKED_IDS.forEach(
                itemId => {
                    lastQuantities.set(
                        itemId,
                        quantities.get(
                            itemId
                        ) || 0
                    );
                }
            );

            pendingItemDecreases.clear();

            return;
        }

        const now =
            Date.now();

        TRACKED_IDS.forEach(
            itemId => {
                const quantity =
                    quantities.get(
                        itemId
                    ) || 0;

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

    function getConsumedCostForIds(
        idSet
    ) {
        if (
            !settings.consumableCostsEnabled
        ) {
            return 0;
        }

        let total = 0;

        consumedItems.forEach(
            (
                quantity,
                itemId
            ) => {
                if (!idSet.has(itemId)) {
                    return;
                }

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

    function getAmmoCost() {
        return getConsumedCostForIds(
            AMMO_IDS
        );
    }

    function getFoodCost() {
        return getConsumedCostForIds(
            FOOD_IDS
        );
    }

    function getRepairCost() {
        return getConsumedCostForIds(
            REPAIR_IDS
        );
    }

    function getConsumableCost() {
        if (
            !settings.consumableCostsEnabled
        ) {
            return 0;
        }

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

        priceWarningTitle.textContent =
            'Price Missing';

        priceWarningMessage.textContent =
            `Open Exchange to load item price: ${missing.join(', ')}.`;

        priceWarning.style.display =
            'block';
    }

    // =========================================================
    // COMBAT DISPLAY
    // =========================================================

    function updateCostWindowDisplay(
        net
    ) {
        costGrossElement.textContent =
            `+${Math.round(
                combatGrossGold
            ).toLocaleString()}`;

        costAmmoElement.textContent =
            `-${Math.round(
                getAmmoCost()
            ).toLocaleString()}`;

        costFoodElement.textContent =
            `-${Math.round(
                getFoodCost()
            ).toLocaleString()}`;

        costRepairsElement.textContent =
            `-${Math.round(
                getRepairCost()
            ).toLocaleString()}`;

        costNetElement.textContent =
            net.toLocaleString();
    }

    function openCostWindow() {
        costWindow.classList.add(
            'tf-open'
        );

        costWindow.style.display =
            'block';

        costWindow.style.zIndex =
            '10000000';

        const net =
            Math.round(
                combatGrossGold -
                getConsumableCost()
            );

        updateCostWindowDisplay(
            net
        );
    }

    function closeCostWindow() {
        costWindow.classList.remove(
            'tf-open'
        );

        costWindow.style.display =
            'none';
    }

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

        netGoldElement.childNodes[0].textContent =
            `${net.toLocaleString()} `;

        updateCostWindowDisplay(
            net
        );

        netGoldElement.title =
            [
                `Gold earned: ${Math.round(combatGrossGold).toLocaleString()}`,
                `Consumables: -${Math.round(getConsumableCost()).toLocaleString()}`,
                `Net gold: ${net.toLocaleString()}`
            ].join('\n');

        updateCombatHeaderLayout();
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

    /*
     * Tidefall may restore combat history several seconds after
     * the page appears. Keep treating every visible victory as
     * baseline history until the victory list has remained stable
     * for three seconds. A ten-second maximum prevents the tracker
     * from remaining locked indefinitely.
     */
    const victoryBaselineInterval =
        setInterval(
            () => {
                const entries =
                    getVictoryEntries();

                if (
                    entries.length !==
                    victoryBaselineCount
                ) {
                    victoryBaselineCount =
                        entries.length;

                    victoryBaselineLastChangedAt =
                        Date.now();
                }

                entries.forEach(
                    entry => {
                        const id =
                            entry.dataset.sentAt;

                        if (id) {
                            processedVictories.add(
                                id
                            );
                        }
                    }
                );

                const stableFor =
                    Date.now() -
                    victoryBaselineLastChangedAt;

                const baselineAge =
                    Date.now() -
                    victoryBaselineStartedAt;

                if (
                    stableFor >= 3000 ||
                    baselineAge >= 10000
                ) {
                    entries.forEach(
                        entry => {
                            const id =
                                entry.dataset.sentAt;

                            if (id) {
                                processedVictories.add(
                                    id
                                );
                            }
                        }
                    );

                    victoryTrackingReady =
                        true;

                    clearInterval(
                        victoryBaselineInterval
                    );

                    console.log(
                        '[First Mate] Victory tracking ready; restored combat history ignored.'
                    );
                }
            },
            250
        );

    function processVictory(entry) {
        if (
            !settings
                .combatTrackerEnabled
        ) {
            return;
        }

        const id =
            entry.dataset.sentAt;

        if (!id) {
            return;
        }

        if (!victoryTrackingReady) {
            if (
                !processedVictories.has(
                    id
                )
            ) {
                victoryBaselineLastChangedAt =
                    Date.now();
            }

            processedVictories.add(
                id
            );

            return;
        }

        if (
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
                settings.combatSessionLayout ===
                    'header'
                    ? 'none'
                    : 'block';

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

    function resetCombatSession() {
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

        lastCombatTime =
            0;

        closeCostWindow();

        combatPanel.style.display =
            'none';

        combatHeaderLayout
            ?.classList.remove(
                'tf-active'
            );

        updateCombatButton();
        updateCombatDisplay();
        updateActivityHeaderLayout();
    }

    function checkPvEAutoReset() {
        if (
            !combatRunning ||
            isActuallyInCombat()
        ) {
            return;
        }

        const delay =
            Number(
                settings.pveTrackerHideDelaySeconds
            );

        if (
            delay === -1 ||
            !Number.isFinite(delay) ||
            lastCombatTime <= 0
        ) {
            return;
        }

        const expired =
            Date.now() -
                lastCombatTime >
            Math.max(
                0,
                delay
            ) * 1000;

        if (!expired) {
            return;
        }

        resetCombatSession();
    }

    // =========================================================
    // COMBAT BUTTONS
    // =========================================================

    netGoldRow.addEventListener(
        'click',
        openCostWindow
    );

    netGoldRow.addEventListener(
        'keydown',
        event => {
            if (
                event.key !== 'Enter' &&
                event.key !== ' '
            ) {
                return;
            }

            event.preventDefault();

            openCostWindow();
        }
    );

    costWindowClose.addEventListener(
        'click',
        closeCostWindow
    );

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
                    settings.combatSessionLayout ===
                        'header'
                        ? 'none'
                        : 'block';
            }

            updateCombatButton();
            updateCombatDisplay();
        }
    );

    combatResetButton.addEventListener(
        'click',
        () => {
            resetCombatSession();
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


    function getTaskEndRemainingSeconds() {
        const element =
            document.querySelector(
                '#task-end-timer'
            );

        if (!element) {
            return null;
        }

        const text =
            element.textContent
                ?.replace(/\s+/g, ' ')
                .trim() || '';

        if (!text) {
            return null;
        }

        const hours =
            Number(
                text.match(/(\d+)\s*h/i)?.[1] || 0
            );

        const minutes =
            Number(
                text.match(/(\d+)\s*m/i)?.[1] || 0
            );

        const seconds =
            Number(
                text.match(/(\d+)\s*s/i)?.[1] || 0
            );

        const total =
            hours * 3600 +
            minutes * 60 +
            seconds;

        return Number.isFinite(total) && total > 0
            ? total
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

            schemaVersion:
                2,

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

    function getLiveActivityTimeToLevel() {
        if (
            activityEstimatedActionsToLevel === null ||
            activityEstimatedActionsToLevel <= 0 ||
            !Number.isFinite(activityCycleSeconds) ||
            activityCycleSeconds <= 0
        ) {
            return activityEstimatedTimeToLevel;
        }

        const currentCountdown =
            getActivityCycleCountdown();

        const firstActionSeconds =
            Number.isFinite(currentCountdown) &&
            currentCountdown >= 0
                ? currentCountdown
                : activityCycleSeconds;

        return (
            firstActionSeconds +
            Math.max(
                0,
                activityEstimatedActionsToLevel - 1
            ) *
            activityCycleSeconds
        );
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
    // ACTIVITY QUEUE REMAINING
    // =========================================================

    let queueHydrationInProgress =
        false;

    let queueHydratedOnce =
        false;

    let queueCountdownSignature =
        '';

    let queueCountdownBaseSeconds =
        0;

    let queueCountdownStartedAt =
        0;

    let queueCountdownApproximate =
        false;

    /*
     * Keep the last complete queue snapshot. Tidefall can unmount
     * or partially render queue rows while the popover is closed,
     * especially when multiple entries use the same recipe.
     */
    let cachedQueuedActivities = [];

    let cachedQueueBadgeCount = 0;

    /*
     * Remember tasks that were observed waiting in Tidefall's
     * queue. When the final queued task becomes active, Tidefall
     * removes the queue badge and rows. Keep Queue Remaining
     * visible for that promoted task until it finishes.
     */
    const queuedPendingTaskNames =
        new Set();

    let queuePromotedTaskName =
        '';

    /*
     * Tidefall briefly removes the active-task panel while
     * promoting the next queued task. Preserve queue state across
     * that gap instead of treating it as the queue ending.
     */
    let queueTransitionGraceUntil =
        0;

    let queueTransitionHoldSeconds =
        0;

    let queueTransitionHoldStartedAt =
        0;

    const QUEUE_TRANSITION_GRACE_MS =
        15000;

    function getQueuedActivityRows() {
        return Array.from(
            document.querySelectorAll(
                '#task-queue-popover .activity-queue-row'
            )
        );
    }

    function hydrateQueueRowsIfNeeded() {
        if (queueHydrationInProgress) {
            return;
        }

        const badge =
            document.querySelector(
                '#task-queue-badge'
            );

        const queueCount =
            numberFromText(
                badge?.textContent
            );

        if (
            !badge ||
            badge.hidden ||
            queueCount <= 0
        ) {
            return;
        }

        /*
         * Tidefall leaves stale queue-row values mounted while the
         * popover is closed. Refresh whenever the badge count differs
         * from the last complete snapshot, or when no complete snapshot
         * has been captured yet.
         */
        const needsRefresh =
            cachedQueuedActivities.length === 0 ||
            queueCount !== cachedQueueBadgeCount;

        if (!needsRefresh) {
            return;
        }

        const button =
            document.querySelector(
                '#task-queue-btn'
            );

        const popover =
            document.querySelector(
                '#task-queue-popover'
            );

        if (!(button instanceof HTMLElement)) {
            return;
        }

        queueHydrationInProgress =
            true;

        const wasOpen =
            button.dataset.open ===
                'true';

        const previousVisibility =
            popover?.style.visibility || '';

        const previousPointerEvents =
            popover?.style.pointerEvents || '';

        /*
         * Hide First Mate's automatic refresh so the user never sees
         * the queue popover flash open. A manually opened popover is
         * left visible and is never closed by First Mate.
         */
        if (!wasOpen && popover instanceof HTMLElement) {
            popover.style.visibility =
                'hidden';

            popover.style.pointerEvents =
                'none';
        }

        if (!wasOpen) {
            button.click();
        }

        setTimeout(
            () => {
                const refreshedBadgeCount =
                    numberFromText(
                        document.querySelector(
                            '#task-queue-badge'
                        )?.textContent
                    );

                /*
                 * Reading the snapshot while data-open is true causes
                 * getQueuedActivitySnapshot() to trust every live row,
                 * including separate entries with the same recipe.
                 */
                getQueuedActivitySnapshot(
                    refreshedBadgeCount
                );

                if (
                    !wasOpen &&
                    button.dataset.open ===
                        'true'
                ) {
                    button.click();
                }

                if (popover instanceof HTMLElement) {
                    popover.style.visibility =
                        previousVisibility;

                    popover.style.pointerEvents =
                        previousPointerEvents;
                }

                queueHydratedOnce =
                    cachedQueuedActivities.length > 0;

                queueHydrationInProgress =
                    false;

                updateQueueRemainingDisplay();
            },
            200
        );
    }

    function getQueuedCycleCount(row) {
        if (
            row &&
            typeof row === 'object' &&
            !(row instanceof HTMLElement) &&
            Number.isFinite(Number(row.cycles))
        ) {
            return Number(row.cycles);
        }

        const text =
            row?.querySelector(
                '.activity-queue-row__sub'
            )?.textContent
                ?.replace(/,/g, '')
                .trim() || '';

        const match =
            text.match(/(\d+)\s+cycles?/i);

        return match
            ? Number(match[1])
            : 0;
    }

    function getQueuedTaskName(row) {
        if (
            row &&
            typeof row === 'object' &&
            !(row instanceof HTMLElement)
        ) {
            return String(row.taskName || '');
        }

        return row?.querySelector(
            '.activity-queue-row__name'
        )?.textContent
            ?.replace(/\s+/g, ' ')
            .trim() || '';
    }

    function getQueuedActivitySnapshot(
        queueCount
    ) {
        const liveRows =
            getQueuedActivityRows();

        const button =
            document.querySelector(
                '#task-queue-btn'
            );

        const popoverOpen =
            button?.dataset.open === 'true';

        const liveEntries =
            liveRows
                .map((row, index) => ({
                    taskName:
                        getQueuedTaskName(row),
                    cycles:
                        getQueuedCycleCount(row),
                    queueId:
                        row.dataset.queueId ||
                        String(index)
                }))
                .filter(entry =>
                    entry.taskName &&
                    entry.cycles > 0
                );

        /*
         * Trust a snapshot only while the popover is open or when
         * Tidefall has rendered at least as many rows as its badge
         * says exist. This prevents a partial closed-popover render
         * from replacing a complete cached queue.
         */
        const snapshotComplete =
            liveEntries.length > 0 &&
            (
                popoverOpen ||
                (
                    queueCount > 0 &&
                    liveEntries.length >= queueCount
                )
            );

        if (snapshotComplete) {
            const grouped =
                new Map();

            liveEntries.forEach(entry => {
                const canonical =
                    normalizeActivityKeyPart(
                        getCanonicalActivityTaskName(
                            entry.taskName
                        )
                    );

                if (!canonical) {
                    return;
                }

                const existing =
                    grouped.get(canonical);

                if (existing) {
                    existing.cycles +=
                        entry.cycles;

                    existing.queueIds.push(
                        entry.queueId
                    );
                } else {
                    grouped.set(
                        canonical,
                        {
                            taskName:
                                entry.taskName,
                            cycles:
                                entry.cycles,
                            canonical,
                            queueIds: [
                                entry.queueId
                            ]
                        }
                    );
                }
            });

            cachedQueuedActivities =
                Array.from(
                    grouped.values()
                );

            cachedQueueBadgeCount =
                queueCount;
        } else if (queueCount <= 0) {
            cachedQueuedActivities = [];
            cachedQueueBadgeCount = 0;
        }

        if (
            queueCount > 0 &&
            cachedQueuedActivities.length > 0
        ) {
            return cachedQueuedActivities;
        }

        return liveEntries;
    }

    function getCanonicalActivityTaskName(taskName) {
        return String(taskName || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(
                /^(?:crafting|sawing|smelting|cooking|mining|logging|chopping|fishing|catching|gathering|harvesting)\s+/i,
                ''
            )
            .trim();
    }

    function getHistoricalCycleSecondsForTask(taskName) {
        const target =
            normalizeActivityKeyPart(
                getCanonicalActivityTaskName(
                    taskName
                )
            );

        if (!target) {
            return null;
        }

        let best = null;

        Object.values(activityHistory)
            .forEach(record => {
                if (
                    !record ||
                    typeof record !== 'object'
                ) {
                    return;
                }

                if (
                    Number(record.schemaVersion) !== 2 ||
                    !String(record.key || '').startsWith('taskv2:')
                ) {
                    return;
                }

                const sameTask =
                    normalizeActivityKeyPart(
                        getCanonicalActivityTaskName(
                            record.taskName
                        )
                    ) === target;

                const seconds =
                    Number(
                        record.cycleSeconds
                    );

                if (
                    !sameTask ||
                    !Number.isFinite(seconds) ||
                    seconds <= 0
                ) {
                    return;
                }

                if (
                    !best ||
                    Number(record.updated || 0) >
                    Number(best.updated || 0)
                ) {
                    best = record;
                }
            });

        return best
            ? Number(best.cycleSeconds)
            : null;
    }

    function getHistoricalRecordForTask(taskName) {
        const target =
            normalizeActivityKeyPart(
                getCanonicalActivityTaskName(
                    taskName
                )
            );

        if (!target) {
            return null;
        }

        let best = null;

        Object.values(activityHistory)
            .forEach(record => {
                if (
                    !record ||
                    typeof record !== 'object'
                ) {
                    return;
                }

                /*
                 * Ignore legacy records because older builds keyed
                 * history by node and could mix multiple recipes.
                 */
                if (
                    Number(record.schemaVersion) !== 2 ||
                    !String(record.key || '').startsWith('taskv2:')
                ) {
                    return;
                }

                const sameTask =
                    normalizeActivityKeyPart(
                        getCanonicalActivityTaskName(
                            record.taskName
                        )
                    ) === target;

                if (!sameTask) {
                    return;
                }

                if (
                    !best ||
                    Number(record.updated || 0) >
                    Number(best.updated || 0)
                ) {
                    best = record;
                }
            });

        return best;
    }


    function getBaseActivityRecipe(taskName) {
        return BASE_ACTIVITY_RECIPES[
            normalizeActivityKeyPart(
                getCanonicalActivityTaskName(
                    taskName
                )
            )
        ] || null;
    }

    function getObservedTaskStats(taskName) {
        const record =
            getHistoricalRecordForTask(taskName);

        if (!record) {
            return null;
        }

        const actions =
            Number(record.totalActions) || 0;

        const totalXP =
            Number(record.totalXP) || 0;

        const cycleSeconds =
            Number(record.cycleSeconds) || 0;

        return {
            skill:
                normalizeActivityKeyPart(
                    record.skill
                ),

            xpPerAction:
                actions > 0 && totalXP > 0
                    ? totalXP / actions
                    : null,

            cycleSeconds:
                cycleSeconds > 0
                    ? cycleSeconds
                    : null,

            source:
                'observed'
        };
    }

    function getCurrentProfessionModifiers() {
        const base =
            getBaseActivityRecipe(
                activityTaskName
            );

        if (
            !base ||
            normalizeActivityKeyPart(base.skill) !==
                normalizeActivityKeyPart(activitySkill)
        ) {
            return {
                masteryXP: 0,
                speedMultiplier: 1
            };
        }

        let observedXP =
            activityEstimatedXPPerAction;

        if (
            !Number.isFinite(observedXP) ||
            observedXP <= 0
        ) {
            observedXP =
                getObservedTaskStats(
                    activityTaskName
                )?.xpPerAction;
        }

        const masteryXP =
            Number.isFinite(observedXP)
                ? Math.max(
                    0,
                    Math.min(
                        9,
                        Math.round(
                            observedXP - base.xp
                        )
                    )
                )
                : 0;

        /*
         * Prefer Tidefall's exact active-task end timer when
         * deriving the current city's profession speed. The
         * visible cycle countdown is rounded to whole seconds,
         * while city haste can produce fractional cycle lengths.
         */
        const exactRemaining =
            getTaskEndRemainingSeconds();

        const cyclesLeft =
            getActivityCyclesLeft();

        const currentCountdown =
            getActivityCycleCountdown();

        let observedCycle = null;

        if (
            Number.isFinite(exactRemaining) &&
            exactRemaining > 0 &&
            Number.isFinite(cyclesLeft) &&
            cyclesLeft > 0
        ) {
            if (
                cyclesLeft > 1 &&
                Number.isFinite(currentCountdown) &&
                currentCountdown >= 0 &&
                exactRemaining > currentCountdown
            ) {
                observedCycle =
                    (exactRemaining - currentCountdown) /
                    (cyclesLeft - 1);
            } else {
                observedCycle =
                    exactRemaining / cyclesLeft;
            }
        }

        if (
            !Number.isFinite(observedCycle) ||
            observedCycle <= 0
        ) {
            observedCycle =
                activityCycleSeconds;
        }

        if (
            !Number.isFinite(observedCycle) ||
            observedCycle <= 0
        ) {
            observedCycle =
                getObservedTaskStats(
                    activityTaskName
                )?.cycleSeconds;
        }

        const speedMultiplier =
            Number.isFinite(observedCycle) &&
            observedCycle > 0 &&
            base.seconds > 0
                ? observedCycle /
                    base.seconds
                : 1;

        return {
            masteryXP,
            speedMultiplier:
                Math.max(
                    0.25,
                    Math.min(
                        2,
                        speedMultiplier
                    )
                )
        };
    }

    function getPredictedTaskStats(taskName) {
        const base =
            getBaseActivityRecipe(taskName);

        if (base) {
            const sameSkill =
                normalizeActivityKeyPart(
                    base.skill
                ) ===
                normalizeActivityKeyPart(
                    activitySkill
                );

            /*
             * For queued recipes in the same profession, always
             * apply the speed multiplier learned from the current
             * active task. Historical recipe timing may have been
             * recorded in another city and must not override the
             * current city's haste.
             */
            if (sameSkill) {
                const modifiers =
                    getCurrentProfessionModifiers();

                return {
                    skill:
                        normalizeActivityKeyPart(
                            base.skill
                        ),

                    xpPerAction:
                        base.xp +
                        modifiers.masteryXP,

                    cycleSeconds:
                        base.seconds *
                        modifiers.speedMultiplier,

                    source:
                        'current-city-adjusted'
                };
            }
        }

        const observed =
            getObservedTaskStats(taskName);

        if (
            observed &&
            Number.isFinite(
                observed.cycleSeconds
            ) &&
            observed.cycleSeconds > 0
        ) {
            return observed;
        }

        if (!base) {
            return null;
        }

        return {
            skill:
                normalizeActivityKeyPart(
                    base.skill
                ),

            xpPerAction:
                base.xp,

            cycleSeconds:
                base.seconds,

            source:
                'base'
        };
    }

    function getQueuedTimeToLevelEstimate() {
        if (
            activityEstimatedXPPerAction === null ||
            activityEstimatedXPPerAction <= 0 ||
            !Number.isFinite(activityCycleSeconds) ||
            activityCycleSeconds <= 0
        ) {
            return getLiveActivityTimeToLevel();
        }

        let remainingXP =
            getActivityRemainingXP();

        if (
            remainingXP === null ||
            remainingXP <= 0
        ) {
            return 0;
        }

        let totalSeconds = 0;

        const currentCycles =
            getActivityCyclesLeft();

        if (
            Number.isFinite(currentCycles) &&
            currentCycles > 0
        ) {
            const currentCountdown =
                getActivityCycleCountdown();

            for (
                let index = 0;
                index < currentCycles;
                index += 1
            ) {
                totalSeconds +=
                    index === 0 &&
                    Number.isFinite(currentCountdown) &&
                    currentCountdown >= 0
                        ? currentCountdown
                        : activityCycleSeconds;

                remainingXP -=
                    activityEstimatedXPPerAction;

                if (remainingXP <= 0) {
                    return totalSeconds;
                }
            }
        }

        const rows =
            getQueuedActivityRows();

        for (const row of rows) {
            const cycles =
                getQueuedCycleCount(row);

            if (cycles <= 0) {
                continue;
            }

            const taskName =
                getQueuedTaskName(row);

            const stats =
                getPredictedTaskStats(
                    taskName
                );

            const sameSkill =
                stats &&
                normalizeActivityKeyPart(
                    stats.skill
                ) ===
                normalizeActivityKeyPart(
                    activitySkill
                );

            const xpPerAction =
                sameSkill &&
                Number.isFinite(
                    stats.xpPerAction
                ) &&
                stats.xpPerAction > 0
                    ? stats.xpPerAction
                    : 0;

            const secondsPerCycle =
                stats &&
                Number.isFinite(
                    stats.cycleSeconds
                ) &&
                stats.cycleSeconds > 0
                    ? stats.cycleSeconds
                    : activityCycleSeconds;

            for (
                let index = 0;
                index < cycles;
                index += 1
            ) {
                totalSeconds +=
                    secondsPerCycle;

                remainingXP -=
                    xpPerAction;

                if (remainingXP <= 0) {
                    return totalSeconds;
                }
            }
        }

        /*
         * The visible queue does not contain enough XP to level.
         * Continue the estimate using the current activity rate so
         * the display still answers how long leveling will take if
         * the same activity continues after the queue finishes.
         */
        return totalSeconds +
            Math.ceil(
                remainingXP /
                activityEstimatedXPPerAction
            ) *
            activityCycleSeconds;
    }

    function getCurrentTaskRemainingSeconds() {
        const cyclesLeft =
            getActivityCyclesLeft();

        if (
            cyclesLeft === null ||
            cyclesLeft <= 0 ||
            !Number.isFinite(
                activityCycleSeconds
            ) ||
            activityCycleSeconds <= 0
        ) {
            return 0;
        }

        /*
         * #task-cycles-left includes the cycle currently in
         * progress. Use the live cycle countdown for that first
         * cycle, then add full cycle lengths for everything after.
         */
        const currentCountdown =
            getActivityCycleCountdown();

        const firstCycleSeconds =
            Number.isFinite(
                currentCountdown
            ) &&
            currentCountdown >= 0
                ? currentCountdown
                : activityCycleSeconds;

        return (
            firstCycleSeconds +
            Math.max(
                0,
                cyclesLeft - 1
            ) *
            activityCycleSeconds
        );
    }

    function setQueueDebug(
        lines,
        force = false
    ) {
        if (!queueDebugContent) {
            return;
        }

        const nextText =
            Array.isArray(lines)
                ? lines.join('\n')
                : String(lines || '');

        queueDebugLatestText =
            nextText;

        if (queueDebugPaused) {
            return;
        }

        const now =
            Date.now();

        if (
            !force &&
            now - queueDebugLastUpdateAt < 1000
        ) {
            return;
        }

        queueDebugLastUpdateAt =
            now;

        if (
            queueDebugContent.textContent !==
            nextText
        ) {
            queueDebugContent.textContent =
                nextText;
        }
    }

    function getQueueRemainingEstimate() {
        hydrateQueueRowsIfNeeded();

        const badge =
            document.querySelector(
                '#task-queue-badge'
            );

        const queueCount =
            numberFromText(
                badge?.textContent
            );

        const rows =
            getQueuedActivitySnapshot(
                queueCount
            );

        const hasWaitingQueue =
            Boolean(
                badge &&
                !badge.hidden &&
                queueCount > 0 &&
                rows.length > 0
            );

        if (hasWaitingQueue) {
            queuePromotedTaskName =
                '';

            queueTransitionGraceUntil =
                Date.now() +
                QUEUE_TRANSITION_GRACE_MS;

            /*
             * Queue Remaining represents the full amount of work
             * still outstanding: the active task plus every task
             * waiting behind it.
             *
             * Tidefall exposes an exact active-task end timer, so
             * use that value directly. This preserves fractional
             * city speed bonuses that are lost in the rounded
             * "Next item in Ns" countdown.
             */
            const activeExactSeconds =
                getTaskEndRemainingSeconds();

            let totalSeconds =
                Number.isFinite(activeExactSeconds) &&
                activeExactSeconds > 0
                    ? activeExactSeconds
                    : getCurrentTaskRemainingSeconds();

            let usedFallback =
                !Number.isFinite(activeExactSeconds) ||
                activeExactSeconds <= 0;

            const currentCycles =
                getActivityCyclesLeft();

            const currentCountdown =
                getActivityCycleCountdown();

            const currentBase =
                getBaseActivityRecipe(
                    activityTaskName
                );

            const currentModifiers =
                getCurrentProfessionModifiers();

            const debugLines = [
                `Active: ${activityTaskName || 'Unknown'}`,
                `Cycles left: ${currentCycles ?? '—'}`,
                `Current countdown: ${currentCountdown ?? '—'}s`,
                `Game end timer: ${activeExactSeconds ?? '—'}s (${Number.isFinite(activeExactSeconds) ? formatDuration(activeExactSeconds) : '—'})`,
                `Base cycle: ${currentBase?.seconds ?? '—'}s`,
                `Derived speed multiplier: ${Number(currentModifiers.speedMultiplier || 1).toFixed(6)}`,
                `Derived active cycle: ${currentBase ? (currentBase.seconds * currentModifiers.speedMultiplier).toFixed(6) : '—'}s`,
                '',
                'Queued:'
            ];

            let foundCycles = false;

            const currentCanonical =
                normalizeActivityKeyPart(
                    getCanonicalActivityTaskName(
                        activityTaskName
                    )
                );

            const signatureParts = [
                `active:${currentCanonical}:${getActivityCyclesLeft() ?? 0}`
            ];

            rows.forEach(row => {
                const cycles =
                    getQueuedCycleCount(row);

                if (cycles <= 0) {
                    return;
                }

                foundCycles = true;

                const taskName =
                    getQueuedTaskName(row);

                const canonicalTaskName =
                    getCanonicalActivityTaskName(
                        taskName
                    );

                if (canonicalTaskName) {
                    queuedPendingTaskNames.add(
                        normalizeActivityKeyPart(
                            canonicalTaskName
                        )
                    );
                }

                const stats =
                    getPredictedTaskStats(
                        taskName
                    );

                let secondsPerCycle =
                    stats?.cycleSeconds;

                if (
                    !Number.isFinite(
                        secondsPerCycle
                    ) ||
                    secondsPerCycle <= 0
                ) {
                    secondsPerCycle =
                        activityCycleSeconds;

                    usedFallback = true;
                } else if (
                    stats.source !== 'observed'
                ) {
                    usedFallback = true;
                }

                if (
                    Number.isFinite(
                        secondsPerCycle
                    ) &&
                    secondsPerCycle > 0
                ) {
                    const queuedBase =
                        getBaseActivityRecipe(
                            taskName
                        );

                    const queuedTotal =
                        cycles * secondsPerCycle;

                    debugLines.push(
                        `${taskName} × ${cycles}`,
                        `  base: ${queuedBase?.seconds ?? '—'}s`,
                        `  source: ${stats?.source || 'fallback'}`,
                        `  effective: ${secondsPerCycle.toFixed(6)}s`,
                        `  total: ${queuedTotal.toFixed(3)}s (${formatDuration(queuedTotal)})`
                    );

                    totalSeconds +=
                        queuedTotal;

                    const queueId =
                        row?.queueIds?.join(',') ||
                        row?.queueId ||
                        row?.dataset?.queueId ||
                        '';

                    signatureParts.push(
                        `${normalizeActivityKeyPart(taskName)}:${cycles}:${queueId}`
                    );
                }
            });

            if (
                totalSeconds <= 0 ||
                (
                    !foundCycles &&
                    !Number.isFinite(activeExactSeconds)
                )
            ) {
                return null;
            }

            debugLines.push(
                '',
                `Final total: ${totalSeconds.toFixed(3)}s (${formatDuration(totalSeconds)})`,
                `Fallback used: ${usedFallback ? 'yes' : 'no'}`
            );

            setQueueDebug(
                debugLines
            );

            queueTransitionHoldSeconds =
                totalSeconds;

            queueTransitionHoldStartedAt =
                Date.now();

            return {
                seconds:
                    totalSeconds,

                approximate:
                    usedFallback,

                signature:
                    signatureParts.join('|')
            };
        }

        queueHydratedOnce =
            false;

        const currentActivity =
            getCurrentActivity();

        if (!currentActivity) {
            setQueueDebug(
                'No active activity detected. Waiting for queue transition or new task.'
            );

            if (
                Date.now() <=
                    queueTransitionGraceUntil &&
                queueTransitionHoldSeconds > 0
            ) {
                const heldElapsed =
                    Math.max(
                        0,
                        (
                            Date.now() -
                            queueTransitionHoldStartedAt
                        ) / 1000
                    );

                return {
                    seconds:
                        Math.max(
                            1,
                            queueTransitionHoldSeconds -
                                heldElapsed
                        ),

                    approximate:
                        queueCountdownApproximate,

                    signature:
                        'queue-transition-hold'
                };
            }

            queuePromotedTaskName =
                '';

            queuedPendingTaskNames.clear();

            queueTransitionGraceUntil =
                0;

            queueTransitionHoldSeconds =
                0;

            return null;
        }

        const currentCanonical =
            normalizeActivityKeyPart(
                getCanonicalActivityTaskName(
                    currentActivity.taskName
                )
            );

        if (
            !queuePromotedTaskName &&
            currentCanonical &&
            queuedPendingTaskNames.has(
                currentCanonical
            )
        ) {
            queuePromotedTaskName =
                currentCanonical;

            queuedPendingTaskNames.delete(
                currentCanonical
            );
        }

        if (
            !queuePromotedTaskName ||
            currentCanonical !==
                queuePromotedTaskName
        ) {
            if (
                Date.now() <=
                    queueTransitionGraceUntil &&
                queueTransitionHoldSeconds > 0
            ) {
                const heldElapsed =
                    Math.max(
                        0,
                        (
                            Date.now() -
                            queueTransitionHoldStartedAt
                        ) / 1000
                    );

                return {
                    seconds:
                        Math.max(
                            1,
                            queueTransitionHoldSeconds -
                                heldElapsed
                        ),

                    approximate:
                        queueCountdownApproximate,

                    signature:
                        'queue-transition-hold'
                };
            }

            queuePromotedTaskName =
                '';

            queuedPendingTaskNames.clear();

            queueTransitionGraceUntil =
                0;

            queueTransitionHoldSeconds =
                0;

            return null;
        }

        queueTransitionGraceUntil =
            0;

        queueTransitionHoldSeconds =
            0;

        const activeSeconds =
            getCurrentTaskRemainingSeconds();

        if (
            !Number.isFinite(activeSeconds) ||
            activeSeconds <= 0
        ) {
            queuePromotedTaskName =
                '';

            return null;
        }

        return {
            seconds:
                activeSeconds,

            approximate:
                false,

            signature:
                `promoted:${currentCanonical}:${getActivityCyclesLeft() ?? 0}:${activityCycleSeconds ?? 0}`
        };
    }

    function updateQueueRemainingDisplay() {
        if (
            !settings.activityQueueRemaining
        ) {
            activityQueueRow.style.display =
                'none';

            activityQueueRemainingElement.textContent =
                '—';

            queueCountdownSignature =
                '';

            queueCountdownBaseSeconds =
                0;

            queueCountdownStartedAt =
                0;

            return;
        }

        const estimate =
            getQueueRemainingEstimate();

        if (!estimate) {
            activityQueueRow.style.display =
                'none';

            activityQueueRemainingElement.textContent =
                '—';

            return;
        }

        /*
         * Start or restart the live countdown whenever the
         * queued task/cycle structure changes.
         */
        if (
            estimate.signature !==
                queueCountdownSignature
        ) {
            queueCountdownSignature =
                estimate.signature;

            queueCountdownBaseSeconds =
                estimate.seconds;

            queueCountdownStartedAt =
                Date.now();

            queueCountdownApproximate =
                estimate.approximate;
        }

        const elapsedSeconds =
            Math.max(
                0,
                (
                    Date.now() -
                    queueCountdownStartedAt
                ) / 1000
            );

        const remainingSeconds =
            Math.max(
                0,
                queueCountdownBaseSeconds -
                    elapsedSeconds
            );

        if (remainingSeconds <= 0) {
            activityQueueRow.style.display =
                'none';

            activityQueueRemainingElement.textContent =
                '—';

            /*
             * The old queue row can remain in Tidefall's DOM
             * briefly after it finishes. Allow First Mate to
             * hydrate/read the queue again so a newly-added
             * queue is detected immediately.
             */
            queueHydratedOnce =
                false;

            return;
        }

        activityQueueRow.style.display =
            'grid';

        activityQueueRemainingElement.textContent =
            formatDuration(
                remainingSeconds
            );
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
        updateQueueRemainingDisplay();

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

        if (
            settings.activitySessionLayout ===
                'header'
        ) {
            activityPanel.style.display =
                'none';

            updateActivityHeaderLayout();

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
            'time' ||
            settings
                .activityLevelMode ===
            'time_queue'
        ) {
            const includesQueue =
                settings.activityLevelMode ===
                    'time_queue';

            activityLevelLabel.textContent =
                activityEstimatedNextLevel !==
                    null
                    ? `${includesQueue ? 'Queued Time' : 'Time'} to Level ${activityEstimatedNextLevel}`
                    : (
                        includesQueue
                            ? 'Queued Time to Level'
                            : 'Time to Level'
                    );

            const liveTimeToLevel =
                includesQueue
                    ? getQueuedTimeToLevelEstimate()
                    : getLiveActivityTimeToLevel();

            activityLevelValue.textContent =
                liveTimeToLevel ===
                    null
                    ? '—'
                    : formatDuration(
                        liveTimeToLevel
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

        updateActivityHeaderLayout();
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

            /*
             * Tidefall briefly removes the active-task DOM while
             * promoting a queued task. Keep the header mounted
             * during that gap so Queue Remaining does not blink
             * off before the promoted task appears.
             */
            const preservingQueueTransition =
                settings.activityQueueRemaining &&
                Date.now() <= queueTransitionGraceUntil &&
                queueTransitionHoldSeconds > 0;

            if (!preservingQueueTransition) {
                activityHeaderLayout
                    ?.classList.remove(
                        'tf-active'
                    );
            } else {
                updateActivityHeaderLayout();
            }

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
    // STARTUP FOLLOW SHIP
    // =========================================================

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
            startupSequenceRunning ||
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

        startupSequenceRunning =
            true;

        try {
            await applyStartupFollowShipOnce();
        } finally {
            startupSequenceRunning =
                false;
        }
    }

    // =========================================================
    // COMBAT HEADER LAYOUT
    // =========================================================

    let combatHeaderLayout =
        null;

    function buildCombatHeaderLayout() {
        if (combatHeaderLayout) {
            return combatHeaderLayout;
        }

        const bar =
            document.createElement('div');

        bar.id =
            'tf-combat-header-layout';

        bar.innerHTML = `
            <span class="tf-combat-header-title">
                PvE
            </span>

            <span class="tf-combat-header-stat" data-kind="kills">
                <span class="tf-combat-header-label">Kills</span>
                <span id="tf-header-combat-kills" class="tf-combat-header-value">0</span>
            </span>

            <span class="tf-combat-header-stat" data-kind="xp">
                <span class="tf-combat-header-label">XP Gained</span>
                <span id="tf-header-combat-xp" class="tf-combat-header-value">0</span>
            </span>

            <span class="tf-combat-header-stat" data-kind="level">
                <span id="tf-header-combat-level-label" class="tf-combat-header-label">Kills to Level</span>
                <span id="tf-header-combat-level" class="tf-combat-header-value">—</span>
            </span>

            <span class="tf-combat-header-stat" data-kind="gold">
                <span class="tf-combat-header-label">Net Gold</span>
                <span id="tf-header-combat-gold" class="tf-combat-header-value">0</span>
            </span>
        `;

        bar.querySelector(
            '[data-kind="gold"]'
        )?.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                openCostWindow();
            }
        );

        combatHeaderLayout =
            bar;

        return bar;
    }

    function mountCombatHeaderLayout() {
        const bar =
            buildCombatHeaderLayout();

        const header =
            findTidefallTopHeader();

        if (!header) {
            return false;
        }

        if (
            window.getComputedStyle(header)
                .position === 'static'
        ) {
            header.style.position =
                'relative';
        }

        if (bar.parentElement !== header) {
            header.appendChild(bar);
        }

        return true;
    }

    function updateCombatHeaderLayout() {
        if (
            settings.combatSessionLayout !==
                'header' ||
            !settings.combatTrackerEnabled
        ) {
            combatHeaderLayout
                ?.classList.remove('tf-active');

            updateActivityHeaderLayout();

            return;
        }

        if (!mountCombatHeaderLayout()) {
            return;
        }

        const combatActive =
            shouldPvEOccupySharedHeader();

        combatHeaderLayout.classList.toggle(
            'tf-active',
            combatActive
        );

        /*
         * Combat has priority over Activity only while the ship
         * is actually fighting. The PvE session itself can keep
         * running in the background between fights.
         */
        updateActivityHeaderLayout();

        if (!combatActive) {
            return;
        }

        const level =
            getSkillLevel('gunnery');

        const killsRemaining =
            getKillsToLevel();

        const net =
            Math.round(
                combatGrossGold -
                getConsumableCost()
            );

        combatHeaderLayout.querySelector(
            '#tf-header-combat-kills'
        ).textContent =
            combatKills.toLocaleString();

        combatHeaderLayout.querySelector(
            '#tf-header-combat-xp'
        ).textContent =
            combatTotalXP.toLocaleString();

        combatHeaderLayout.querySelector(
            '#tf-header-combat-level-label'
        ).textContent =
            level !== null
                ? `Kills to Level ${level + 1}`
                : 'Kills to Level';

        combatHeaderLayout.querySelector(
            '#tf-header-combat-level'
        ).textContent =
            killsRemaining === null
                ? '—'
                : killsRemaining.toLocaleString();

        combatHeaderLayout.querySelector(
            '#tf-header-combat-gold'
        ).textContent =
            net.toLocaleString();
    }

    function applyCombatSessionLayout() {
        if (
            settings.combatSessionLayout ===
                'header'
        ) {
            combatPanel.style.display =
                'none';

            updateCombatHeaderLayout();
        } else {
            combatHeaderLayout
                ?.classList.remove('tf-active');

            if (
                combatRunning &&
                settings.combatTrackerEnabled
            ) {
                combatPanel.style.display =
                    'block';
            }

            updateActivityHeaderLayout();
        }
    }

    // =========================================================
    // ACTIVITY HEADER LAYOUT
    // =========================================================

    let activityHeaderLayout =
        null;

    function findTidefallTopHeader() {
        const candidates =
            Array.from(
                document.querySelectorAll(
                    'header, nav, body > div, body > section'
                )
            );

        return candidates.find(
            element => {
                const text =
                    element.textContent
                        ?.replace(/\s+/g, ' ')
                        .trim()
                        .toUpperCase() || '';

                if (
                    !text.includes(
                        'SAILORS ONLINE'
                    ) ||
                    !text.includes(
                        'SAILED TODAY'
                    )
                ) {
                    return false;
                }

                const rect =
                    element.getBoundingClientRect();

                return (
                    rect.top <= 5 &&
                    rect.height > 30 &&
                    rect.height < 120 &&
                    rect.width >
                        window.innerWidth * .7
                );
            }
        ) || null;
    }

    function buildActivityHeaderLayout() {
        if (activityHeaderLayout) {
            return activityHeaderLayout;
        }

        const bar =
            document.createElement(
                'div'
            );

        bar.id =
            'tf-activity-header-layout';

        bar.innerHTML = `
            <span class="tf-activity-header-title">
                Activity
            </span>

            <span class="tf-activity-header-stat" data-kind="xp">
                <span class="tf-activity-header-label">XP/H</span>
                <span id="tf-header-xp" class="tf-activity-header-value">—</span>
            </span>

            <span class="tf-activity-header-stat" data-kind="items">
                <span class="tf-activity-header-label">Items/H</span>
                <span id="tf-header-items" class="tf-activity-header-value">—</span>
            </span>

            <span class="tf-activity-header-stat" data-kind="level">
                <span id="tf-header-level-label" class="tf-activity-header-label">To Level</span>
                <span id="tf-header-level" class="tf-activity-header-value">—</span>
            </span>

            <span class="tf-activity-header-stat" data-kind="queue">
                <span class="tf-activity-header-label">Queue</span>
                <span id="tf-header-queue" class="tf-activity-header-value">—</span>
            </span>

            <span class="tf-activity-header-stat" data-kind="elapsed">
                <span class="tf-activity-header-label">Elapsed</span>
                <span id="tf-header-elapsed" class="tf-activity-header-value">—</span>
            </span>

            <span id="tf-header-task" class="tf-activity-header-task"></span>
        `;

        activityHeaderLayout =
            bar;

        return bar;
    }

    function mountActivityHeaderLayout() {
        const bar =
            buildActivityHeaderLayout();

        const header =
            findTidefallTopHeader();

        if (!header) {
            return false;
        }

        if (
            window.getComputedStyle(
                header
            ).position === 'static'
        ) {
            header.style.position =
                'relative';
        }

        if (
            bar.parentElement !==
            header
        ) {
            header.appendChild(
                bar
            );
        }

        return true;
    }

    function updateActivityHeaderLayout() {
        if (
            settings.activitySessionLayout !==
                'header'
        ) {
            activityHeaderLayout
                ?.classList.remove(
                    'tf-active'
                );

            return;
        }

        if (!mountActivityHeaderLayout()) {
            return;
        }

        const combatHasHeaderPriority =
            settings.combatSessionLayout ===
                'header' &&
            shouldPvEOccupySharedHeader();

        /*
         * Only show the Activity header while Tidefall's
         * currently-running task still matches the activity
         * session being tracked. Navigation can temporarily
         * replace/remove the active-task DOM, and the periodic
         * header refresh used to re-show stale Activity data,
         * which caused the header to blink.
         */
        const currentActivity =
            getCurrentActivity();

        const activityStillActive =
            Boolean(
                currentActivity &&
                currentActivity.skill ===
                    activitySkill &&
                currentActivity.taskName ===
                    activityTaskName
            );

        /*
         * Read queue state before deciding header visibility.
         * A promoted queued task starts a fresh activity session
         * with zero completed actions, but the header must remain
         * visible through that handoff.
         */
        const queueEstimate =
            getQueueRemainingEstimate();

        const preservingQueueTransition =
            Boolean(
                queueEstimate &&
                (
                    queuePromotedTaskName ||
                    (
                        Date.now() <= queueTransitionGraceUntil &&
                        queueTransitionHoldSeconds > 0
                    )
                )
            );

        const visible =
            settings.activityTrackerEnabled &&
            activityStarted &&
            (
                activityActions > 0 ||
                preservingQueueTransition
            ) &&
            !activityPanelClosed &&
            (
                activityStillActive ||
                preservingQueueTransition
            ) &&
            !combatHasHeaderPriority;

        activityHeaderLayout.classList.toggle(
            'tf-active',
            visible
        );

        if (!visible) {
            return;
        }

        const xp =
            activityEstimatedXPPerHour ===
                null
                ? '—'
                : Math.round(
                    activityEstimatedXPPerHour
                ).toLocaleString();

        const items =
            activityEstimatedItemsPerHour ===
                null
                ? '—'
                : Math.round(
                    activityEstimatedItemsPerHour
                ).toLocaleString();

        const nextLevel =
            activityEstimatedNextLevel;

        const liveTimeToLevel =
            getLiveActivityTimeToLevel();

        const queueTimeToLevel =
            settings.activityLevelMode ===
                'time_queue'
                ? getQueuedTimeToLevelEstimate()
                : null;

        const levelValue =
            settings.activityLevelMode ===
                'time' ||
            settings.activityLevelMode ===
                'time_queue'
                ? (
                    (
                        settings.activityLevelMode ===
                            'time_queue'
                            ? queueTimeToLevel
                            : liveTimeToLevel
                    ) === null
                        ? '—'
                        : formatDuration(
                            settings.activityLevelMode ===
                                'time_queue'
                                ? queueTimeToLevel
                                : liveTimeToLevel
                        )
                )
                : (
                    activityEstimatedActionsToLevel ===
                        null
                        ? '—'
                        : activityEstimatedActionsToLevel
                            .toLocaleString()
                );

        const queueText =
            queueEstimate
                ? activityQueueRemainingElement
                    .textContent
                : '—';

        activityHeaderLayout.querySelector(
            '#tf-header-xp'
        ).textContent =
            xp;

        activityHeaderLayout.querySelector(
            '#tf-header-items'
        ).textContent =
            items;

        activityHeaderLayout.querySelector(
            '#tf-header-level-label'
        ).textContent =
            settings.activityLevelMode ===
                'time' ||
            settings.activityLevelMode ===
                'time_queue'
                ? (
                    nextLevel !== null
                        ? `${settings.activityLevelMode === 'time_queue' ? 'Queued Time' : 'Time'} to Level ${nextLevel}`
                        : (
                            settings.activityLevelMode ===
                                'time_queue'
                                ? 'Queued Time to Level'
                                : 'Time to Level'
                        )
                )
                : (
                    nextLevel !== null
                        ? `Actions to Level ${nextLevel}`
                        : 'Actions to Level'
                );

        activityHeaderLayout.querySelector(
            '#tf-header-level'
        ).textContent =
            levelValue;

        const queueStat =
            activityHeaderLayout.querySelector(
                '[data-kind="queue"]'
            );

        queueStat.style.display =
            settings.activityQueueRemaining &&
            queueEstimate
                ? 'flex'
                : 'none';

        activityHeaderLayout.querySelector(
            '#tf-header-queue'
        ).textContent =
            queueText;

        activityHeaderLayout.querySelector(
            '#tf-header-elapsed'
        ).textContent =
            formatDuration(
                getActivityElapsedSeconds()
            );

        activityHeaderLayout.querySelector(
            '#tf-header-task'
        ).textContent =
            `${titleCaseSkill(activitySkill)} • ${activityTaskName}`;
    }

    function applyActivitySessionLayout() {
        const headerMode =
            settings.activitySessionLayout ===
                'header';

        if (headerMode) {
            activityPanel.style.display =
                'none';

            updateActivityHeaderLayout();
        } else {
            activityHeaderLayout
                ?.classList.remove(
                    'tf-active'
                );

            updateActivityDisplay();
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
            'tf-firstmate-toggle';

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
            'tf-firstmate-number-wrap';

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
            'tf-firstmate-number';

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
            'tf-firstmate-unit';

        unitElement.textContent =
            unit;

        wrapper.append(
            input,
            unitElement
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
            'tf-firstmate-select';

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

                const value =
                    settingKey ===
                        'pveTrackerHideDelaySeconds'
                        ? Number(
                            select.value
                        )
                        : select.value;

                updateSetting(
                    settingKey,
                    value
                );

                updateActivityDisplay();

                if (
                    settingKey ===
                    'activitySessionLayout'
                ) {
                    applyActivitySessionLayout();
                }

                if (
                    settingKey ===
                    'combatSessionLayout'
                ) {
                    applyCombatSessionLayout();
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
            'acp-card tf-firstmate-card';

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
            'tf-firstmate-toggle-row';

        const label =
            document.createElement(
                'span'
            );

        label.className =
            'tf-firstmate-setting-label';

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
                'tf-firstmate-threshold-row';

            thresholdRow.dataset
                .parentToggle =
                toggleKey;

            const thresholdLabel =
                document.createElement(
                    'span'
                );

            thresholdLabel.className =
                'tf-firstmate-setting-label';

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
            'tf-firstmate-settings-group';

        const heading =
            document.createElement(
                'div'
            );

        heading.className =
            'tf-firstmate-settings-group-title';

        heading.textContent =
            title;

        group.appendChild(
            heading
        );

        return group;
    }

    function createCollapsibleSettingsGroup(
        title,
        storageKey,
        defaultOpen = false
    ) {
        const group =
            document.createElement('div');

        group.className =
            'tf-firstmate-collapsible-group';

        let isOpen =
            defaultOpen;

        try {
            const saved =
                localStorage.getItem(storageKey);

            if (saved !== null) {
                isOpen = saved === 'true';
            }
        } catch {
            // Ignore developer-section storage failures.
        }

        const heading =
            document.createElement('button');

        heading.type = 'button';
        heading.className =
            'tf-firstmate-collapsible-heading';

        const arrow =
            document.createElement('span');

        arrow.className =
            'tf-firstmate-collapsible-arrow';

        const label =
            document.createElement('span');

        label.textContent = title;

        const content =
            document.createElement('div');

        content.className =
            'tf-firstmate-collapsible-content';

        function applyState() {
            group.classList.toggle(
                'tf-collapsed',
                !isOpen
            );

            arrow.textContent =
                isOpen ? '▼' : '▶';

            heading.setAttribute(
                'aria-expanded',
                String(isOpen)
            );
        }

        heading.append(arrow, label);
        heading.addEventListener(
            'click',
            () => {
                isOpen = !isOpen;
                applyState();

                try {
                    localStorage.setItem(
                        storageKey,
                        String(isOpen)
                    );
                } catch {
                    // Ignore developer-section storage failures.
                }
            }
        );

        group.append(heading, content);
        group.settingsContent = content;

        applyState();

        return group;
    }

    function createVersionCard() {
        const card =
            document.createElement(
                'div'
            );

        card.className =
            'acp-card tf-firstmate-card';

        const meta =
            document.createElement(
                'div'
            );

        meta.className =
            'acp-card-meta';

        meta.innerHTML = `
            <div class="acp-card-title">
                Tidefall First Mate
            </div>

            <div class="acp-card-desc">
                Installed addon version.
            </div>
        `;

        const cardBody =
            document.createElement(
                'div'
            );

        cardBody.className =
            'acp-card-body tf-firstmate-version-card';

        const version =
            document.createElement(
                'span'
            );

        version.className =
            'tf-firstmate-version-value';

        version.textContent =
            `v${FIRST_MATE_VERSION}`;

        const githubButton =
            document.createElement(
                'button'
            );

        githubButton.type =
            'button';

        githubButton.className =
            'tf-firstmate-github-button';

        githubButton.textContent =
            'Open GitHub';

        githubButton.addEventListener(
            'click',
            () => {
                window.open(
                    FIRST_MATE_GITHUB_URL,
                    '_blank',
                    'noopener,noreferrer'
                );
            }
        );

        cardBody.append(
            version,
            githubButton
        );

        card.append(
            meta,
            cardBody
        );

        return card;
    }

    function createRefreshCard() {
        const card =
            document.createElement(
                'div'
            );

        card.className =
            'acp-card tf-firstmate-card';

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
            'tf-firstmate-refresh-button';

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

    function buildFirstMateSettingsSection() {
        const section =
            document.createElement(
                'section'
            );

        section.id =
            'tf-firstmate-settings-section';

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
                    'Track PvE kills, XP, Gunnery level progress, and net session gold. Combat takes the header during fights; an active Activity takes it back afterward while the PvE session continues in the background.',

                toggleKey:
                    'combatTrackerEnabled',

                extraContent:
                    cardBody => {
                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-firstmate-select-row';

                        row.dataset.parentToggle =
                            'combatTrackerEnabled';

                        const label =
                            document.createElement(
                                'span'
                            );

                        label.className =
                            'tf-firstmate-setting-label';

                        label.textContent =
                            'Session Layout';

                        row.append(
                            label,
                            createSelect(
                                'combatSessionLayout',
                                [
                                    {
                                        value:
                                            'header',
                                        label:
                                            'Header'
                                    },
                                    {
                                        value:
                                            'standard',
                                        label:
                                            'Floating Panel'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            row
                        );

                        const hideDelayRow =
                            document.createElement(
                                'div'
                            );

                        hideDelayRow.className =
                            'tf-firstmate-select-row';

                        hideDelayRow.dataset.parentToggle =
                            'combatTrackerEnabled';

                        const hideDelayLabel =
                            document.createElement(
                                'span'
                            );

                        hideDelayLabel.className =
                            'tf-firstmate-setting-label';

                        hideDelayLabel.textContent =
                            'Hide After Combat';

                        hideDelayRow.append(
                            hideDelayLabel,
                            createSelect(
                                'pveTrackerHideDelaySeconds',
                                [
                                    {
                                        value:
                                            '15',
                                        label:
                                            '15 seconds'
                                    },
                                    {
                                        value:
                                            '30',
                                        label:
                                            '30 seconds'
                                    },
                                    {
                                        value:
                                            '60',
                                        label:
                                            '60 seconds'
                                    },
                                    {
                                        value:
                                            '-1',
                                        label:
                                            'Never'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            hideDelayRow
                        );

                        const consumableCostsRow =
                            document.createElement(
                                'div'
                            );

                        consumableCostsRow.className =
                            'tf-firstmate-toggle-row';

                        consumableCostsRow.dataset.parentToggle =
                            'combatTrackerEnabled';

                        const consumableCostsLabel =
                            document.createElement(
                                'span'
                            );

                        consumableCostsLabel.className =
                            'tf-firstmate-setting-label';

                        consumableCostsLabel.textContent =
                            'Consumable Costs';

                        consumableCostsRow.append(
                            consumableCostsLabel,
                            createToggle(
                                'consumableCostsEnabled'
                            )
                        );

                        cardBody.appendChild(
                            consumableCostsRow
                        );

                    }
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



        const activityGroup =
            createSettingsGroup(
                'Activity'
            );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Activity Tracker',

                description:
                    'Track non-combat XP, actual mastery-adjusted item output, and next-level progress. Header mode automatically returns after combat ends.',

                toggleKey:
                    'activityTrackerEnabled',

                extraContent:
                    cardBody => {

                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-firstmate-select-row';

                        row.dataset
                            .parentToggle =
                            'activityTrackerEnabled';

                        const label =
                            document.createElement(
                                'span'
                            );

                        label.className =
                            'tf-firstmate-setting-label';

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
                                    },
                                    {
                                        value:
                                            'time_queue',
                                        label:
                                            'Time to Level Including Queue'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            row
                        );

                        const layoutRow =
                            document.createElement(
                                'div'
                            );

                        layoutRow.className =
                            'tf-firstmate-select-row';

                        layoutRow.dataset
                            .parentToggle =
                            'activityTrackerEnabled';

                        const layoutLabel =
                            document.createElement(
                                'span'
                            );

                        layoutLabel.className =
                            'tf-firstmate-setting-label';

                        layoutLabel.textContent =
                            'Session Layout';

                        layoutRow.append(
                            layoutLabel,
                            createSelect(
                                'activitySessionLayout',
                                [
                                    {
                                        value:
                                            'header',
                                        label:
                                            'Header'
                                    },
                                    {
                                        value:
                                            'standard',
                                        label:
                                            'Floating Panel'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            layoutRow
                        );
                    }
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Skill Progress Percentage',

                description:
                    'Show the current percentage directly on each skill progress bar.',

                toggleKey:
                    'skillProgressPercentEnabled'
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Queue Remaining',

                description:
                    'Show estimated remaining time for queued activities in the Activity Session panel.',

                toggleKey:
                    'activityQueueRemaining'
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

        const developerGroup =
            createCollapsibleSettingsGroup(
                'Developer Tools',
                DEVELOPER_TOOLS_SECTION_KEY,
                false
            );

        developerGroup.settingsContent.appendChild(
            createSettingsCard({
                title:
                    'Queue Debugger',

                description:
                    'Show live queue timing data used by First Mate. Includes pause, copy, minimize, drag, and resize controls.',

                toggleKey:
                    'queueDebuggerEnabled'
            })
        );

        const displayGroup =
            createSettingsGroup(
                'Display & Camera'
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
            createVersionCard()
        );

        displayGroup.appendChild(
            createRefreshCard()
        );

        section.append(
            combatGroup,
            activityGroup,
            developerGroup,
            displayGroup
        );

        return section;
    }

    function refreshSettingsUI() {
        document
            .querySelectorAll(
                '.tf-firstmate-toggle[data-setting]'
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
                '.tf-firstmate-select[data-setting]'
            )
            .forEach(
                select => {
                    select.value =
                        String(
                            settings[
                                select.dataset
                                    .setting
                            ]
                        );
                }
            );

        document
            .querySelectorAll(
                '.tf-firstmate-slider[data-setting]'
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
                                '.tf-firstmate-slider-value'
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
                        'tf-firstmate-disabled',
                        !settings[
                            row.dataset
                                .parentToggle
                        ]
                    );
                }
            );
    }

    // =========================================================
    // FIRST MATE'S SETTINGS TAB
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

    function closeFirstMateSettings() {
        document
            .querySelectorAll(
                '.tf-firstmate-native-hidden'
            )
            .forEach(
                element => {
                    element.classList.remove(
                        'tf-firstmate-native-hidden'
                    );
                }
            );

        document
            .getElementById(
                'tf-firstmate-settings-section'
            )
            ?.remove();

        document
            .getElementById(
                'tf-firstmate-settings-tab'
            )
            ?.classList.remove(
                'panel-tab--active'
            );
    }

    function injectFirstMateSettingsTab() {
        const nav =
            getAccountNav();

        if (!nav) {
            return;
        }

        let button =
            nav.querySelector(
                '#tf-firstmate-settings-tab'
            );

        if (!button) {
            button =
                document.createElement(
                    'button'
                );

            button.id =
                'tf-firstmate-settings-tab';

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
                                    'tf-firstmate-settings-section'
                        )
                        .forEach(
                            element => {
                                element.classList.add(
                                    'tf-firstmate-native-hidden'
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
                            'tf-firstmate-settings-section'
                        );

                    if (!section) {
                        section =
                            buildFirstMateSettingsSection();

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
                    'tf-firstmate-settings-tab'
                ) {
                    return;
                }

                if (
                    tab.dataset
                        .firstMateBound ===
                    '1'
                ) {
                    return;
                }

                tab.dataset
                    .firstMateBound =
                    '1';

                tab.addEventListener(
                    'click',
                    closeFirstMateSettings,
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

        const queueDebuggerEnabledNow =
            Boolean(settings.queueDebuggerEnabled);

        if (
            queueDebuggerEnabledNow !==
            queueDebuggerLastEnabled
        ) {
            queueDebugSessionClosed = false;
            queueDebuggerLastEnabled =
                queueDebuggerEnabledNow;
        }

        updateQueueDebugVisibility();

        if (
            settings.skillProgressPercentEnabled
        ) {
            bindSkillProgressBars();
        } else {
            disconnectSkillProgressObservers();
            removeSkillProgressLabels();
        }

        checkCombatWarnings();

        updateCombatDisplay();

        updateActivityDisplay();
        applyActivitySessionLayout();
        applyCombatSessionLayout();
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
                '[FirstMate Tools] Could not save activity panel position:',
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
                '[FirstMate Tools] Could not restore activity panel position:',
                error
            );
        }
    }

    function saveQueueDebugPosition() {
        const rect =
            queueDebugPanel.getBoundingClientRect();

        try {
            localStorage.setItem(
                QUEUE_DEBUG_POSITION_KEY,
                JSON.stringify({
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                })
            );
        } catch {
            // Ignore developer-tool position failures.
        }
    }

    function restoreQueueDebugPosition() {
        try {
            const saved =
                JSON.parse(
                    localStorage.getItem(
                        QUEUE_DEBUG_POSITION_KEY
                    ) || 'null'
                );

            if (!saved) {
                return;
            }

            if (Number.isFinite(saved.left)) {
                queueDebugPanel.style.left =
                    `${Math.max(0, saved.left)}px`;
                queueDebugPanel.style.bottom =
                    'auto';
            }

            if (Number.isFinite(saved.top)) {
                queueDebugPanel.style.top =
                    `${Math.max(0, saved.top)}px`;
            }

            if (Number.isFinite(saved.width)) {
                queueDebugPanel.style.width =
                    `${Math.max(300, saved.width)}px`;
            }

            if (Number.isFinite(saved.height)) {
                queueDebugPanel.style.height =
                    `${Math.max(120, saved.height)}px`;
            }
        } catch {
            // Ignore malformed developer-tool position data.
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

                if (
                    panel ===
                    queueDebugPanel
                ) {
                    saveQueueDebugPosition();
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


    makePanelDraggable(
        costWindow,
        costWindowHeader
    );

    makePanelDraggable(
        queueDebugPanel,
        queueDebugHeader
    );

    new ResizeObserver(
        saveQueueDebugPosition
    ).observe(
        queueDebugPanel
    );

    // =========================================================
    // OBSERVERS
    // =========================================================

    let accountObserverTimer =
        null;

    const accountObserver =
        new MutationObserver(
            () => {
                if (accountObserverTimer !== null) {
                    return;
                }

                accountObserverTimer =
                    window.setTimeout(
                        () => {
                            accountObserverTimer =
                                null;

                            if (getAccountNav()) {
                                injectFirstMateSettingsTab();
                            }

                            if (
                                settings.skillProgressPercentEnabled
                            ) {
                                bindSkillProgressBars();
                            }
                        },
                        100
                    );
            }
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
        () => {
            if (
                (
                    settings.activityLevelMode === 'time' ||
                    settings.activityLevelMode === 'time_queue'
                ) &&
                settings.activitySessionLayout === 'standard'
            ) {
                updateActivityDisplay();
            }
        },
        1000
    );

    setInterval(
        updateActivityHeaderLayout,
        1000
    );

    setInterval(
        updateCombatHeaderLayout,
        1000
    );

    setInterval(
        checkPvEAutoReset,
        500
    );


    setInterval(
        () => {
            void applyStartupDisplayAndCamera();
        },
        500
    );

    setInterval(
        checkNavigationFollowShip,
        250
    );

    // =========================================================
    // INITIALIZE
    // =========================================================

    /*
     * A page reload always begins a fresh PvE session.
     */
    combatRunning =
        false;

    combatKills = 0;
    combatTotalXP = 0;
    combatGrossGold = 0;

    consumedItems.clear();
    sessionPrices.clear();
    lastQuantities.clear();
    pendingItemDecreases.clear();

    lastCombatTime =
        0;

    restoreActivityPanelPosition();
    restoreQueueDebugPosition();
    restoreQueueDebugState();

    document
        .getElementById(
            'firstmate-version-wrap'
        )
        ?.remove();

    document
        .getElementById(
            'firstmate-version-link'
        )
        ?.remove();

    injectFirstMateSettingsTab();

    scanMarketPrices();

    updateCombatDisplay();

    updateCombatButton();

    updateActivityDisplay();

    bindSkillProgressBars();

    handleSettingsChanged();

    checkIdleWarning();


    void applyStartupDisplayAndCamera();
})();
