// ==UserScript==
// @name         Tidefall First Mate
// @namespace    tidefall-first-mate
// @version      1.11.1
// @description  Combat and DPS tracking, combat warnings, activity/XP tracking, queue tools, market pricing, session history, and First Mate Settings
// @icon         https://www.google.com/s2/favicons?sz=64&domain=playtidefall.com
// @match        https://www.playtidefall.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // STORAGE
    // =========================================================

    const SETTINGS_STORAGE_KEY = 'tf-firstmate-settings-v2';
    const PRICE_STORAGE_KEY = 'tf-pve-market-prices-v3';
    const QUARTERMASTER_STORAGE_KEY = 'tf-quartermaster-v1';
    const ACTIVITY_POSITION_KEY = 'tf-activity-panel-position-v1';
    const ACTIVITY_HISTORY_KEY = 'tf-activity-history-v1';
    const COMBAT_HISTORY_KEY = 'tf-combat-session-history-v1';
    const QUEUE_DEBUG_POSITION_KEY = 'tf-queue-debug-position-v1';
    const QUEUE_DEBUG_STATE_KEY = 'tf-queue-debug-state-v1';
    const DEVELOPER_TOOLS_SECTION_KEY = 'tf-developer-tools-section-open-v1';

    const FIRST_MATE_VERSION = '1.9.8';
    const FIRST_MATE_BUILD_ID = '2026-08-16-glow-qty-check';
    const FIRST_MATE_GITHUB_URL =
        'https://github.com/UserCarl/tidefall-first-mate';

    const DEFAULT_SETTINGS = {
        combatTrackerEnabled: true,
        combatDamageTrackerEnabled: true,
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

        healGlowEnabled: true,

        idleWarningEnabled: true,
        idleWarningSeconds: 30,

        activityTrackerEnabled: true,
        activityLevelMode: 'actions',
        activitySessionLayout: 'header',
        combatSessionLayout: 'header',
        pveTrackerHideDelaySeconds: 30,
        activityQueueRemaining: true,
        queueCompletionDetailsEnabled: true,
        actualVsTheoreticalXPEnabled: true,
        rollingXPRatesEnabled: true,
        queueFinishedNotificationEnabled: false,
        combatSessionHistoryEnabled: true,
        queueDebuggerEnabled: false,

        combatShowNetGold: true,
        combatPerHourMetric: 'net',

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
    let combatDamageTrackerLastEnabled =
        Boolean(settings.combatDamageTrackerEnabled);

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
    // COMBAT SESSION HISTORY
    // =========================================================

    const COMBAT_HISTORY_MAX = 20;

    let combatSessionHistory = [];

    try {
        const savedHistory = JSON.parse(
            localStorage.getItem(
                COMBAT_HISTORY_KEY
            ) || '[]'
        );

        if (Array.isArray(savedHistory)) {
            combatSessionHistory =
                savedHistory.slice(
                    0,
                    COMBAT_HISTORY_MAX
                );
        }
    } catch {
        combatSessionHistory = [];
    }

    function saveCombatSessionHistory() {
        try {
            localStorage.setItem(
                COMBAT_HISTORY_KEY,
                JSON.stringify(
                    combatSessionHistory.slice(
                        0,
                        COMBAT_HISTORY_MAX
                    )
                )
            );
        } catch (error) {
            console.warn(
                '[FirstMate Tools] Could not save combat history:',
                error
            );
        }
    }

    // =========================================================
    // CONFIG
    // =========================================================

    const COMBAT_LEFT = 158;
    const COMBAT_TOP = 60;

    const ACTIVITY_RIGHT = 158;
    const ACTIVITY_TOP = 60;

    const COMBAT_SCAN_INTERVAL = 5000;
    const ITEM_SCAN_INTERVAL = 250;
    const ITEM_DECREASE_CONFIRM_MS = 750;
    const ITEM_TRACKING_COMBAT_GRACE_MS = 2000;
    const MARKET_SCAN_INTERVAL = 1500;
    const DISPLAY_INTERVAL = 1000;
    const WARNING_SCAN_INTERVAL = 500;
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
        240: 'Master Refit Crate',

        211: 'Copper 2-Pounder',
        212: 'Iron 4-Pounder',
        213: 'Cinder 6-Pounder',
        214: 'Darkiron 8-Pounder',
        215: 'Mithril 9-Pounder',
        216: 'Adamantite 12-Pounder',
        217: 'Starmetal 18-Pounder',
        218: 'Stormglass 24-Pounder',
        219: 'Leviathan 32-Pounder',
        220: 'Abyssal 42-Pounder'
    };

    const AMMO_IDS = new Set([
        201, 202, 203, 204, 205,
        206, 207, 208, 209, 210
    ]);

    /*
     * Cannons are not consumed from inventory like ammo/food/repair
     * kits. They wear down in place (condition drops on the equipped
     * hold slot) and are priced as a fraction of a full replacement
     * cannon. Deliberately left out of AMMO_IDS/FOOD_IDS/REPAIR_IDS
     * so the ammo-HUD consumable scanner never mistakes an equipped
     * cannon for ammo. They do end up in TRACKED_IDS via ITEM_NAMES,
     * which is harmless and lets the Exchange price scanner capture
     * live cannon prices too.
     */
    const CANNON_IDS = new Set([
        211, 212, 213, 214, 215,
        216, 217, 218, 219, 220
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


    /*
     * Built-in vendor values provide a conservative fallback when no
     * current Exchange listing or recent trade has been captured. Current
     * Exchange listings always take priority for replacement-cost estimates.
     */
    const BUILT_IN_VENDOR_PRICES = {
        201: 3,
        202: 6,
        203: 9,
        204: 11,
        205: 12,
        206: 21,
        207: 25,
        208: 34,
        209: 55,
        210: 105,

        221: 10,
        222: 18,
        223: 22,
        224: 30,
        225: 14,
        226: 42,
        227: 48,
        228: 60,
        229: 68,
        230: 90,

        231: 13,
        232: 54,
        233: 92,
        234: 190,
        235: 245,
        236: 530,
        237: 745,
        238: 1350,
        239: 1200,
        240: 3350,

        211: 325,
        212: 725,
        213: 1300,
        214: 1975,
        215: 2850,
        216: 4750,
        217: 7650,
        218: 13000,
        219: 28000,
        220: 73000
    };

    function normalizeItemName(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    const ITEM_ID_BY_NAME = new Map(
        Object.entries(ITEM_NAMES).map(
            ([itemId, itemName]) => [
                normalizeItemName(itemName),
                Number(itemId)
            ]
        )
    );

    /*
     * Tidefall can add new combat ammunition/consumables without
     * First Mate knowing their IDs ahead of time. Learn those IDs
     * directly from the live combat HUD so quantity tracking and
     * warnings do not break when a new shot type is equipped.
     */
    function registerCombatHudItem(
        element,
        itemId
    ) {
        if (
            !Number.isFinite(itemId) ||
            itemId <= 0
        ) {
            return false;
        }

        if (TRACKED_IDS.has(itemId)) {
            return true;
        }

        const title =
            String(
                element?.getAttribute?.('title') ||
                element?.dataset?.itemName ||
                ''
            )
                .replace(/\s+/g, ' ')
                .trim();

        const className =
            String(
                element?.className ||
                ''
            );

        const isAmmo =
            /combat-ammo-hud-mun-tile/i
                .test(className) ||
            /\bshot\b/i.test(title);

        const isRepair =
            /combat-ammo-hud-con-tile/i
                .test(className) &&
            /repair\s+hull|repair\s+kit|repair/i
                .test(title);

        const isFood =
            /combat-ammo-hud-con-tile/i
                .test(className) &&
            /heal\s+crew|ration|stew|mackerel|sardine|salmon|tuna|swordfish|shark|steak|fillet|feast/i
                .test(title);

        if (
            !isAmmo &&
            !isRepair &&
            !isFood
        ) {
            return false;
        }

        const itemName =
            title
                .replace(/\s+-\s+.*$/, '')
                .trim() ||
            `Combat Item ${itemId}`;

        ITEM_NAMES[itemId] =
            itemName;

        TRACKED_IDS.add(
            itemId
        );

        ITEM_ID_BY_NAME.set(
            normalizeItemName(itemName),
            itemId
        );

        if (isAmmo) {
            AMMO_IDS.add(itemId);
        } else if (isRepair) {
            REPAIR_IDS.add(itemId);
        } else if (isFood) {
            FOOD_IDS.add(itemId);
        }

        console.info(
            '[Tidefall First Mate] Learned combat item:',
            itemId,
            itemName
        );

        return true;
    }


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

    function formatQueueFinishClock(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '—';
        }

        return new Date(
            Date.now() + seconds * 1000
        ).toLocaleTimeString(
            [],
            {
                hour: 'numeric',
                minute: '2-digit'
            }
        );
    }

    function formatCompletionTimeAt(timestamp) {
        const target = new Date(timestamp);

        if (!Number.isFinite(target.getTime())) {
            return '—';
        }

        const now = new Date();
        const todayStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
        ).getTime();
        const targetStart = new Date(
            target.getFullYear(),
            target.getMonth(),
            target.getDate()
        ).getTime();
        const dayOffset = Math.round(
            (targetStart - todayStart) /
            86400000
        );
        const clock = target.toLocaleTimeString(
            [],
            {
                hour: 'numeric',
                minute: '2-digit'
            }
        );

        if (dayOffset === 0) {
            return clock;
        }

        if (dayOffset === 1) {
            return `Tomorrow ${clock}`;
        }

        return `${target.toLocaleDateString([], {
            month: 'short',
            day: 'numeric'
        })} ${clock}`;
    }

    function formatRate(value) {
        return Number.isFinite(value) && value >= 0
            ? Math.round(value).toLocaleString()
            : '—';
    }

    function formatSignedRate(value) {
        return Number.isFinite(value)
            ? Math.round(value).toLocaleString()
            : '—';
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
    // LOW-OVERHEAD DOM HELPERS
    // =========================================================

    /*
     * First Mate shares Tidefall's main browser thread. Avoid creating
     * DOM mutations when a displayed value has not actually changed.
     * This is especially important because several observers watch the
     * page for game updates.
     */
    function setTextIfChanged(
        element,
        value
    ) {
        if (!element) {
            return false;
        }

        const next =
            String(value);

        if (element.textContent === next) {
            return false;
        }

        element.textContent =
            next;

        return true;
    }

    function setDisplayIfChanged(
        element,
        value
    ) {
        if (
            !element ||
            element.style.display === value
        ) {
            return false;
        }

        element.style.display =
            value;

        return true;
    }

    function setHTMLIfChanged(
        element,
        value
    ) {
        if (!element) {
            return false;
        }

        const next =
            String(value);

        if (element.dataset.tfLastHtml === next) {
            return false;
        }

        element.innerHTML =
            next;

        element.dataset.tfLastHtml =
            next;

        return true;
    }

    function setClassEnabled(
        element,
        className,
        enabled
    ) {
        if (!element) {
            return false;
        }

        const shouldEnable =
            Boolean(enabled);

        if (
            element.classList.contains(
                className
            ) === shouldEnable
        ) {
            return false;
        }

        element.classList.toggle(
            className,
            shouldEnable
        );

        return true;
    }

    const FIRST_MATE_OWNED_SELECTOR = [
        '#tf-pve-panel',
        '#tf-cost-window',
        '#tf-damage-window',
        '#tf-activity-panel',
        '#tf-queue-debug',
        '#tf-idle-warning',
        '#tf-combat-warning',
        '#tf-price-warning',
        '#tf-activity-header-layout',
        '#tf-combat-header-layout',
        '#tf-firstmate-settings-section',
        '#tf-firstmate-settings-tab'
    ].join(',');

    function isFirstMateOwnedNode(
        node
    ) {
        const element =
            node?.nodeType === 1
                ? node
                : node?.parentElement;

        return Boolean(
            element?.closest?.(
                FIRST_MATE_OWNED_SELECTOR
            )
        );
    }

    function hasNonFirstMateMutation(
        mutations
    ) {
        return mutations.some(
            mutation => {
                if (
                    !isFirstMateOwnedNode(
                        mutation.target
                    )
                ) {
                    return true;
                }

                return [
                    ...mutation.addedNodes,
                    ...mutation.removedNodes
                ].some(
                    node =>
                        !isFirstMateOwnedNode(
                            node
                        )
                );
            }
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

        #tf-net-gold,
        #tf-per-hour-value {
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

        #tf-damage-window {
            top: 130px;
            left: 50%;
            transform: translateX(-50%);
            width: 320px;
            display: none;
        }

        #tf-damage-window.tf-open {
            display: block;
        }

        #tf-damage-window-body {
            padding: 12px 16px 16px;
        }

        #tf-damage-window .tf-damage-note {
            margin-top: 8px;
            color: var(--text-secondary, #d4be8ca6);
            font-size: 10px;
            line-height: 1.35;
        }

        #tf-damage-window .tf-damage-section-title {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, .12);
            color: var(--reward-gold, #f0c45c);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
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

        .tf-activity-header-stat[data-kind="queue"] .tf-activity-header-value {
            color: var(--text-primary, #e8e0d0);
        }

        .tf-activity-header-task {
            max-width: 180px;

            overflow: hidden;
            text-overflow: ellipsis;

            color: var(--text-secondary, #d4be8ca6);

            font-size: 10px;
        }

        .tf-activity-header-stat[data-kind="queue"],
        .tf-activity-header-stat[data-kind="xp"] {
            position: relative;
            pointer-events: auto;
        }

        .tf-header-hover-tooltip {
            position: fixed;
            top: 0;
            left: 0;
            transform: none;
            z-index: 10000020;
            display: none;
            min-width: 290px;
            max-width: min(440px, 80vw);
            padding: 10px 12px;
            color: var(--text-primary, #e8e0d0);
            background: rgba(5, 7, 10, .98);
            border: 1px solid rgba(197, 160, 89, .72);
            border-radius: 6px;
            box-shadow: 0 7px 24px rgba(0, 0, 0, .65);
            font-size: 11px;
            line-height: 1.35;
            white-space: normal;
            pointer-events: none;
        }

        .tf-header-hover-tooltip.tf-open {
            display: block;
        }

        .tf-header-tooltip-title {
            margin-bottom: 7px;
            color: var(--gold, #c5a059);
            font-family: var(--font-heading, Georgia, serif);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .tf-header-tooltip-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 14px;
            align-items: baseline;
            padding: 3px 0;
            border-bottom: 1px solid rgba(197, 160, 89, .10);
        }

        .tf-header-tooltip-row:last-child {
            border-bottom: 0;
        }

        .tf-header-tooltip-row span {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-secondary, #d4be8ca6);
        }

        .tf-header-tooltip-row strong {
            color: var(--text-primary, #e8e0d0);
            font-weight: 700;
            white-space: nowrap;
        }

        .tf-header-tooltip-subtitle {
            margin: 7px 0 3px;
            color: var(--text-secondary, #d4be8ca6);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        #tf-combat-history-window {
            top: 110px;
            left: 80px;
            width: 560px;
            max-width: calc(100vw - 24px);
            display: none;
            z-index: 10000000;
        }

        #tf-combat-history-window.tf-open {
            display: block;
        }

        #tf-combat-history-body {
            max-height: 480px;
            overflow: auto;
            padding: 10px 12px 12px;
        }

        .tf-combat-history-empty {
            padding: 18px 8px;
            color: var(--text-muted, #ffffff4d);
            text-align: center;
        }

        .tf-combat-history-entry {
            padding: 9px 0;
            border-bottom: 1px solid rgba(197, 160, 89, .16);
        }

        .tf-combat-history-entry:last-child {
            border-bottom: 0;
        }

        .tf-combat-history-time {
            margin-bottom: 5px;
            color: var(--gold, #c5a059);
            font-size: 10px;
            font-weight: 700;
        }

        .tf-combat-history-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 5px 12px;
            font-size: 11px;
        }

        .tf-combat-history-grid div {
            display: flex;
            justify-content: space-between;
            gap: 8px;
        }

        .tf-combat-history-grid span {
            color: var(--text-secondary, #d4be8ca6);
        }

        .tf-combat-history-grid strong {
            color: var(--text-primary, #e8e0d0);
            white-space: nowrap;
        }

        #tf-combat-history-clear {
            width: auto;
            min-width: 48px;
            padding: 0 9px;
            border-radius: 13px;
            font-size: 10px;
        }

        #tf-queue-finished-warning {
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000030;
            display: none;
            min-width: 360px;
            max-width: 80vw;
            padding: 14px 28px;
            text-align: center;
            font-family: var(--font-heading);
            font-size: var(--font-size-2xl);
            font-weight: 900;
            letter-spacing: .08em;
            text-transform: uppercase;
            color: #ff3b30;
            background: rgba(5, 7, 10, .94);
            border: 3px solid #ff3b30;
            border-radius: var(--radius-md);
            box-shadow: 0 0 28px rgba(255, 59, 48, .35);
            pointer-events: auto;
            cursor: pointer;
        }

        #tf-queue-finished-warning.tf-open {
            display: block;
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

        .tf-combat-header-stat[data-kind="gold"] .tf-combat-header-value,
        .tf-combat-header-stat[data-kind="perhour"] .tf-combat-header-value {
            color: var(--reward-gold, #f0c45c);
        }

        .tf-combat-header-stat[data-kind="dps"] .tf-combat-header-value {
            color: var(--text-danger, #e86b60);
        }

        .tf-combat-header-stat[data-kind="gold"],
        .tf-combat-header-stat[data-kind="dps"] {
            pointer-events: auto;
            cursor: pointer;
        }

        .tf-combat-header-title.tf-history-enabled {
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

            <div
                id="tf-per-hour-row"
                class="tf-stat-row"
            >
                <span
                    id="tf-per-hour-label"
                    class="tf-stat-label"
                >
                    Net Profit / hr
                </span>

                <span
                    id="tf-per-hour-value"
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

                <button
                    id="tf-combat-history"
                    class="tf-reset-button"
                    type="button"
                >
                    HISTORY
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

    const perHourLabelElement =
        combatPanel.querySelector(
            '#tf-per-hour-label'
        );

    const perHourValueElement =
        combatPanel.querySelector(
            '#tf-per-hour-value'
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

            <div class="tf-cost-row tf-negative">
                <span>Cannon Wear</span>
                <strong id="tf-cost-cannons">-0</strong>
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

    const damageWindow =
        document.createElement('div');

    damageWindow.id =
        'tf-damage-window';

    damageWindow.className =
        'tf-session-panel';

    damageWindow.innerHTML = `
        <div
            id="tf-damage-window-header"
            class="tf-session-header"
        >
            <div class="tf-session-title">
                Damage Breakdown
            </div>

            <button
                id="tf-damage-window-close"
                class="tf-window-btn"
                type="button"
                title="Close"
            >
                ×
            </button>
        </div>

        <div id="tf-damage-window-body">
            <div class="tf-cost-row tf-total">
                <span>DMG</span>
                <strong id="tf-damage-dps">—</strong>
            </div>
            <div class="tf-cost-row">
                <span>Average Hit</span>
                <strong id="tf-damage-average">—</strong>
            </div>
            <div class="tf-cost-row">
                <span>Minimum Hit</span>
                <strong id="tf-damage-min">—</strong>
            </div>
            <div class="tf-cost-row">
                <span>Maximum Hit</span>
                <strong id="tf-damage-max">—</strong>
            </div>
            <div class="tf-cost-row">
                <span>Total Damage</span>
                <strong id="tf-damage-total">0</strong>
            </div>
            <div class="tf-cost-row">
                <span>Ammo</span>
                <strong id="tf-damage-ammo">—</strong>
            </div>
            <div class="tf-cost-row">
                <span>Hits</span>
                <strong id="tf-damage-hits">0</strong>
            </div>
            <div class="tf-cost-row">
                <span>Misses</span>
                <strong id="tf-damage-misses">0</strong>
            </div>
            <div class="tf-cost-row">
                <span>Accuracy</span>
                <strong id="tf-damage-accuracy">—</strong>
            </div>


            <div class="tf-damage-note">
                Damage is measured from Tidefall's outgoing combat events for the current combat session.
            </div>
        </div>
    `;

    document.body.appendChild(
        damageWindow
    );

    const combatHistoryWindow =
        document.createElement('div');

    combatHistoryWindow.id =
        'tf-combat-history-window';

    combatHistoryWindow.className =
        'tf-session-panel';

    combatHistoryWindow.innerHTML = `
        <div
            id="tf-combat-history-header"
            class="tf-session-header"
        >
            <div class="tf-session-title">
                Combat Session History
            </div>

            <button
                id="tf-combat-history-clear"
                class="tf-window-btn"
                type="button"
                title="Clear history"
            >
                Clear
            </button>

            <button
                id="tf-combat-history-close"
                class="tf-window-btn"
                type="button"
                title="Close"
            >
                ×
            </button>
        </div>

        <div id="tf-combat-history-body"></div>
    `;

    document.body.appendChild(
        combatHistoryWindow
    );

    const queueFinishedToast =
        document.createElement('div');

    queueFinishedToast.id =
        'tf-queue-finished-warning';

    queueFinishedToast.title =
        'Click to dismiss';

    queueFinishedToast.innerHTML = `
        <div class="tf-community-warning-brand">
            ⚓ Tidefall First Mate - Community Addon
        </div>

        <div class="tf-community-warning-title">
            Queue Finished
        </div>

        <div class="tf-community-warning-message">
            Activity queue finished.
        </div>
    `;

    document.body.appendChild(
        queueFinishedToast
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

    const costCannonElement =
        costWindow.querySelector(
            '#tf-cost-cannons'
        );

    const costNetElement =
        costWindow.querySelector(
            '#tf-cost-net'
        );

    const damageWindowHeader =
        damageWindow.querySelector(
            '#tf-damage-window-header'
        );

    const damageWindowClose =
        damageWindow.querySelector(
            '#tf-damage-window-close'
        );

    const damageDpsElement =
        damageWindow.querySelector('#tf-damage-dps');
    const damageAverageElement =
        damageWindow.querySelector('#tf-damage-average');
    const damageMinElement =
        damageWindow.querySelector('#tf-damage-min');
    const damageMaxElement =
        damageWindow.querySelector('#tf-damage-max');
    const damageTotalElement =
        damageWindow.querySelector('#tf-damage-total');
    const damageAmmoElement =
        damageWindow.querySelector('#tf-damage-ammo');
    const damageHitsElement =
        damageWindow.querySelector('#tf-damage-hits');
    const damageMissesElement =
        damageWindow.querySelector('#tf-damage-misses');
    const damageAccuracyElement =
        damageWindow.querySelector('#tf-damage-accuracy');



    const startStopButton =
        combatPanel.querySelector(
            '#tf-start-stop'
        );

    const combatResetButton =
        combatPanel.querySelector(
            '#tf-reset'
        );

    const combatHistoryButton =
        combatPanel.querySelector(
            '#tf-combat-history'
        );

    const combatHistoryHeader =
        combatHistoryWindow.querySelector(
            '#tf-combat-history-header'
        );

    const combatHistoryBody =
        combatHistoryWindow.querySelector(
            '#tf-combat-history-body'
        );

    const combatHistoryClearButton =
        combatHistoryWindow.querySelector(
            '#tf-combat-history-clear'
        );

    const combatHistoryCloseButton =
        combatHistoryWindow.querySelector(
            '#tf-combat-history-close'
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
                <span
                    id="tf-activity-xp-hour-label"
                    class="tf-stat-label"
                >
                    XP / Hour
                </span>

                <span
                    id="tf-activity-xp-hour"
                    class="tf-stat-value"
                >
                    —
                </span>
            </div>

            <div
                id="tf-activity-actual-xp-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">Actual XP / Hour</span>
                <span id="tf-activity-actual-xp-hour" class="tf-stat-value">—</span>
            </div>

            <div
                id="tf-activity-xp-efficiency-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">XP Efficiency</span>
                <span id="tf-activity-xp-efficiency" class="tf-stat-value">—</span>
            </div>

            <div
                id="tf-activity-rolling-5m-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">Rolling XP / Hour 5m</span>
                <span id="tf-activity-rolling-5m" class="tf-stat-value">—</span>
            </div>

            <div
                id="tf-activity-rolling-15m-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">Rolling XP / Hour 15m</span>
                <span id="tf-activity-rolling-15m" class="tf-stat-value">—</span>
            </div>

            <div
                id="tf-activity-rolling-1h-row"
                class="tf-stat-row"
                style="display: none;"
            >
                <span class="tf-stat-label">Rolling XP / Hour 1h</span>
                <span id="tf-activity-rolling-1h" class="tf-stat-value">—</span>
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

    const activityXpHourLabel =
        activityPanel.querySelector(
            '#tf-activity-xp-hour-label'
        );

    const activityActualXpRow =
        activityPanel.querySelector(
            '#tf-activity-actual-xp-row'
        );

    const activityActualXpHourElement =
        activityPanel.querySelector(
            '#tf-activity-actual-xp-hour'
        );

    const activityXpEfficiencyRow =
        activityPanel.querySelector(
            '#tf-activity-xp-efficiency-row'
        );

    const activityXpEfficiencyElement =
        activityPanel.querySelector(
            '#tf-activity-xp-efficiency'
        );

    const activityRolling5mRow =
        activityPanel.querySelector(
            '#tf-activity-rolling-5m-row'
        );

    const activityRolling5mElement =
        activityPanel.querySelector(
            '#tf-activity-rolling-5m'
        );

    const activityRolling15mRow =
        activityPanel.querySelector(
            '#tf-activity-rolling-15m-row'
        );

    const activityRolling15mElement =
        activityPanel.querySelector(
            '#tf-activity-rolling-15m'
        );

    const activityRolling1hRow =
        activityPanel.querySelector(
            '#tf-activity-rolling-1h-row'
        );

    const activityRolling1hElement =
        activityPanel.querySelector(
            '#tf-activity-rolling-1h'
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
    let combatSessionStartedAt = 0;
    let combatHistoryArchivedCurrentSession = false;

    let combatDamageTotal = 0;
    let combatDamageHits = 0;
    let combatDamageMisses = 0;
    let combatDamageMin = Infinity;
    let combatDamageMax = 0;
    let combatDamageActiveMs = 0;
    let combatDamageActiveStartedAt = 0;
    let combatDamageFirstEventAt = 0;
    let combatDamageLastEventAt = 0;

    const processedDamageEvents =
        new Set();

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
     * Last observed condition (current, not max) for each equipped
     * cannon hold slot, keyed by "ship:slot" so 14 cannons on one
     * ship wear down independently.
     */
    const lastCannonConditions =
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

    function getCombatSessionDurationSeconds() {
        if (!combatSessionStartedAt) {
            return 0;
        }

        const endAt =
            lastCombatTime > combatSessionStartedAt
                ? lastCombatTime
                : Date.now();

        return Math.max(
            1,
            (endAt - combatSessionStartedAt) /
                1000
        );
    }

    function resetCombatDamageSession() {
        combatDamageTotal = 0;
        combatDamageHits = 0;
        combatDamageMisses = 0;
        combatDamageMin = Infinity;
        combatDamageMax = 0;
        combatDamageActiveMs = 0;
        combatDamageActiveStartedAt = 0;
        combatDamageFirstEventAt = 0;
        combatDamageLastEventAt = 0;
        processedDamageEvents.clear();
        markCurrentDamageEventsProcessed();
        updateDamageWindowDisplay();
    }

    function updateCombatDamageClock() {
        if (!settings.combatDamageTrackerEnabled) {
            combatDamageActiveStartedAt = 0;
            return;
        }

        const now = Date.now();
        const active =
            combatRunning &&
            isActuallyInCombat();

        if (active) {
            if (!combatDamageActiveStartedAt) {
                combatDamageActiveStartedAt = now;
            }
            return;
        }

        if (combatDamageActiveStartedAt) {
            combatDamageActiveMs +=
                Math.max(0, now - combatDamageActiveStartedAt);
            combatDamageActiveStartedAt = 0;
        }
    }

    function parseCombatEventTimestamp(entry) {
        const raw = Number(entry?.dataset?.sentAt);

        if (!Number.isFinite(raw) || raw <= 0) {
            return Date.now();
        }

        return raw < 1e11
            ? raw * 1000
            : raw;
    }

    function recordCombatDamageEventTime(entry) {
        const timestamp =
            parseCombatEventTimestamp(entry);

        if (
            !combatDamageFirstEventAt ||
            timestamp < combatDamageFirstEventAt
        ) {
            combatDamageFirstEventAt = timestamp;
        }

        if (
            !combatDamageLastEventAt ||
            timestamp > combatDamageLastEventAt
        ) {
            combatDamageLastEventAt = timestamp;
        }
    }

    function getCombatDamageActiveSeconds() {
        /* Prefer Tidefall's own combat-event timestamps so DPS is based on
         * the actual outgoing-hit/miss event spacing instead of First Mate's
         * scan timing. A one-shot encounter uses a one-second floor. */
        if (
            combatDamageFirstEventAt > 0 &&
            combatDamageLastEventAt > 0
        ) {
            return Math.max(
                1,
                (
                    combatDamageLastEventAt -
                    combatDamageFirstEventAt
                ) / 1000
            );
        }

        let ms = combatDamageActiveMs;

        if (combatDamageActiveStartedAt) {
            ms += Math.max(
                0,
                Date.now() - combatDamageActiveStartedAt
            );
        }

        return Math.max(1, ms / 1000);
    }

    function getCombatDps() {
        if (
            combatDamageTotal <= 0 ||
            combatDamageHits <= 0
        ) {
            return 0;
        }

        return combatDamageTotal /
            getCombatDamageActiveSeconds();
    }

    function getCombatAverageHit() {
        return combatDamageHits > 0
            ? combatDamageTotal / combatDamageHits
            : 0;
    }

    function getCombatAccuracy() {
        const attempts =
            combatDamageHits + combatDamageMisses;

        return attempts > 0
            ? combatDamageHits / attempts * 100
            : NaN;
    }

    function markCurrentDamageEventsProcessed() {
        document.querySelectorAll('[data-sent-at]')
            .forEach(entry => {
                const id = entry.dataset.sentAt;
                if (id) processedDamageEvents.add(id);
            });
    }

    function parseOutgoingDamageEvent(entry) {
        if (!entry) return null;

        /*
         * Tidefall exposes the event direction/type in the combat-row class.
         * This is much more reliable than parsing English message wording:
         *   combat-row--outgoing-hit = damage dealt by the player
         *   combat-row--miss         = player attack missed
         *   combat-row--incoming-hit = damage received by the player
         */
        if (entry.classList?.contains('combat-row--miss')) {
            return { type: 'miss', damage: 0 };
        }

        if (!entry.classList?.contains('combat-row--outgoing-hit')) {
            return null;
        }

        const text = String(entry.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

        /* First prefer explicit damage nodes/attributes if Tidefall exposes
         * one in this render. Keep the selector intentionally broad because
         * the row class is already a definitive outgoing-hit signal. */
        const explicitDamageNodes = [
            ...entry.querySelectorAll(
                '[data-damage], .combat-val--damage, [class*="damage"], [class*="Damage"]'
            )
        ];

        for (const node of explicitDamageNodes) {
            const value = numberFromText(
                node.dataset?.damage ||
                node.getAttribute?.('data-value') ||
                node.textContent
            );

            if (value > 0) {
                return { type: 'hit', damage: value };
            }
        }

        /* Common combat-message forms. Since the row itself proves this is
         * outgoing damage, these patterns do not need direction words. */
        const damagePatterns = [
            /(?:damage|dmg)\D{0,18}([\d,]+(?:\.\d+)?)/i,
            /([\d,]+(?:\.\d+)?)\s*(?:damage|dmg)\b/i,
            /(?:hull|crew|rigging)\D{0,18}([\d,]+(?:\.\d+)?)/i,
            /(?:for|dealt?|deals?|hit(?:s)?(?:\s+for)?)\D{0,18}([\d,]+(?:\.\d+)?)/i
        ];

        for (const pattern of damagePatterns) {
            const match = text.match(pattern);
            if (!match) continue;

            const damage = numberFromText(match[1]);
            if (damage > 0) {
                return { type: 'hit', damage };
            }
        }

        /* Fallback for Tidefall rows whose visible text is only a numeric
         * damage value. Avoid blindly using numbers from weapon names such as
         * "12-Pounder" unless there is only one sensible numeric value in the
         * row. */
        const numericCandidates = [];

        entry.querySelectorAll('span, strong, b, em')
            .forEach(node => {
                const nodeText = String(node.textContent || '').trim();
                if (!nodeText) return;

                const matches = nodeText.match(/\b[\d,]+(?:\.\d+)?\b/g) || [];
                matches.forEach(raw => {
                    const value = numberFromText(raw);
                    if (value > 0) numericCandidates.push(value);
                });
            });

        const uniqueCandidates = [...new Set(numericCandidates)];
        if (uniqueCandidates.length === 1) {
            return {
                type: 'hit',
                damage: uniqueCandidates[0]
            };
        }

        /* Leave the row unprocessed if its damage value has not been filled
         * yet. A later characterData/child mutation can then parse it again. */
        return null;
    }

    function processDamageEvent(entry) {
        if (
            !settings.combatTrackerEnabled ||
            !settings.combatDamageTrackerEnabled
        ) {
            return;
        }

        const id = entry?.dataset?.sentAt;
        if (!id) return;

        /* Ignore restored combat history during the same warm-up window
         * already used by the victory tracker. */
        if (!victoryTrackingReady) {
            processedDamageEvents.add(id);
            return;
        }

        if (processedDamageEvents.has(id)) {
            return;
        }

        const event =
            parseOutgoingDamageEvent(entry);

        /* Some Tidefall log nodes are inserted before their final text is
         * populated. Only mark a live entry processed after it actually
         * parses as a hit/miss so a later characterData mutation can still
         * be recognized. */
        if (!event) {
            return;
        }

        processedDamageEvents.add(id);
        recordCombatDamageEventTime(entry);

        if (
            !combatRunning &&
            combatKills === 0 &&
            combatDamageHits === 0 &&
            combatDamageMisses === 0 &&
            isActuallyInCombat()
        ) {
            combatRunning = true;
            combatSessionStartedAt = Date.now();
            combatHistoryArchivedCurrentSession = false;
            lastCombatTime = Date.now();

            if (lastQuantities.size === 0) {
                initializeItemTracking();
            } else {
                pendingItemDecreases.clear();

                getEquippedConsumables()
                    .forEach(
                        (quantity, itemId) => {
                            const price =
                                getCachedPrice(itemId);

                            if (
                                quantity > 0 &&
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

            combatPanel.style.display =
                settings.combatSessionLayout ===
                    'header'
                    ? 'none'
                    : 'block';

            combatStatusElement.textContent =
                'Tracking combat...';

            updateCombatButton();
        }

        updateCombatDamageClock();

        if (event.type === 'miss') {
            combatDamageMisses += 1;
            updateDamageWindowDisplay();
            updateCombatHeaderLayout();
            return;
        }

        const damage =
            Number(event.damage) || 0;

        if (damage <= 0) return;

        combatDamageTotal += damage;
        combatDamageHits += 1;
        combatDamageMin = Math.min(
            combatDamageMin,
            damage
        );
        combatDamageMax = Math.max(
            combatDamageMax,
            damage
        );

        updateDamageWindowDisplay();
        updateCombatHeaderLayout();
    }

    function scanDamageEvents() {
        if (!settings.combatDamageTrackerEnabled) {
            return;
        }

        document.querySelectorAll(
            '.log-entry.log-combat.combat-row--outgoing-hit[data-sent-at], ' +
            '.log-entry.log-combat.combat-row--miss[data-sent-at]'
        ).forEach(processDamageEvent);
    }

    function archiveCombatSession() {
        if (
            !settings.combatSessionHistoryEnabled ||
            combatHistoryArchivedCurrentSession ||
            combatKills <= 0
        ) {
            return;
        }

        const durationSeconds =
            getCombatSessionDurationSeconds();
        const ammoCost = getAmmoCost();
        const foodCost = getFoodCost();
        const repairCost = getRepairCost();
        const cannonWearCost = getCannonWearCost();
        const consumableCost =
            getConsumableCost();
        const netGold =
            combatGrossGold - consumableCost;
        const hours =
            Math.max(
                durationSeconds / 3600,
                1 / 3600
            );

        const sessionEndedAt =
            lastCombatTime > combatSessionStartedAt
                ? lastCombatTime
                : Date.now();

        combatSessionHistory.unshift({
            id:
                `${Date.now()}-${combatKills}-${Math.round(combatGrossGold)}`,
            startedAt:
                combatSessionStartedAt || Date.now(),
            endedAt:
                sessionEndedAt,
            durationSeconds,
            kills:
                combatKills,
            xp:
                combatTotalXP,
            grossGold:
                combatGrossGold,
            ammoCost,
            foodCost,
            repairCost,
            cannonWearCost,
            consumableCost,
            netGold,
            netGoldPerHour:
                netGold / hours,
            xpPerHour:
                combatTotalXP / hours,
            damageTotal:
                combatDamageTotal,
            damageHits:
                combatDamageHits,
            damageMisses:
                combatDamageMisses,
            damageDps:
                getCombatDps(),
            damageAverage:
                getCombatAverageHit(),
            damageMin:
                Number.isFinite(combatDamageMin)
                    ? combatDamageMin
                    : 0,
            damageMax:
                combatDamageMax
        });

        combatSessionHistory =
            combatSessionHistory.slice(
                0,
                COMBAT_HISTORY_MAX
            );

        combatHistoryArchivedCurrentSession =
            true;

        saveCombatSessionHistory();
        renderCombatSessionHistory();
    }

    function renderCombatSessionHistory() {
        if (!combatHistoryBody) {
            return;
        }

        combatHistoryBody.replaceChildren();

        if (
            !settings.combatSessionHistoryEnabled ||
            combatSessionHistory.length === 0
        ) {
            const empty =
                document.createElement('div');

            empty.className =
                'tf-combat-history-empty';

            empty.textContent =
                settings.combatSessionHistoryEnabled
                    ? 'No completed combat sessions yet.'
                    : 'Combat Session History is disabled in First Mate settings.';

            combatHistoryBody.appendChild(empty);
            return;
        }

        combatSessionHistory.forEach(
            session => {
                const entry =
                    document.createElement('div');

                entry.className =
                    'tf-combat-history-entry';

                const time =
                    document.createElement('div');

                time.className =
                    'tf-combat-history-time';

                time.textContent =
                    new Date(
                        Number(session.endedAt) ||
                        Date.now()
                    ).toLocaleString(
                        [],
                        {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                        }
                    );

                const grid =
                    document.createElement('div');

                grid.className =
                    'tf-combat-history-grid';

                const rows = [
                    [
                        'Duration',
                        formatDuration(
                            Number(session.durationSeconds) || 0
                        )
                    ],
                    [
                        'Kills',
                        Math.round(
                            Number(session.kills) || 0
                        ).toLocaleString()
                    ],
                    [
                        'XP',
                        Math.round(
                            Number(session.xp) || 0
                        ).toLocaleString()
                    ],
                    [
                        'Gross',
                        `${Math.round(
                            Number(session.grossGold) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Ammo',
                        `-${Math.round(
                            Number(session.ammoCost) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Food',
                        `-${Math.round(
                            Number(session.foodCost) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Repairs',
                        `-${Math.round(
                            Number(session.repairCost) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Cannons',
                        `-${Math.round(
                            Number(session.cannonWearCost) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Net',
                        `${Math.round(
                            Number(session.netGold) || 0
                        ).toLocaleString()}g`
                    ],
                    [
                        'Net / hr',
                        `${formatRate(
                            Number(session.netGoldPerHour)
                        )}g`
                    ],
                    [
                        'XP / hr',
                        formatRate(
                            Number(session.xpPerHour)
                        )
                    ]
                ];

                if (
                    Number(session.damageHits) > 0 ||
                    Number(session.damageMisses) > 0
                ) {
                    rows.push(
                        [
                            'DMG',
                            Math.round(
                                Number(session.damageAverage) || 0
                            ).toLocaleString()
                        ],
                        [
                            'Avg Hit',
                            Math.round(
                                Number(session.damageAverage) || 0
                            ).toLocaleString()
                        ],
                        [
                            'Min / Max',
                            `${Math.round(
                                Number(session.damageMin) || 0
                            ).toLocaleString()} / ${Math.round(
                                Number(session.damageMax) || 0
                            ).toLocaleString()}`
                        ]
                    );
                }

                rows.forEach(
                    ([labelText, valueText]) => {
                        const row =
                            document.createElement('div');
                        const label =
                            document.createElement('span');
                        const value =
                            document.createElement('strong');

                        label.textContent =
                            labelText;
                        value.textContent =
                            valueText;

                        row.append(
                            label,
                            value
                        );
                        grid.appendChild(row);
                    }
                );

                entry.append(
                    time,
                    grid
                );
                combatHistoryBody.appendChild(entry);
            }
        );
    }

    function openCombatSessionHistory() {
        if (!settings.combatSessionHistoryEnabled) {
            return;
        }

        renderCombatSessionHistory();
        combatHistoryWindow.classList.add(
            'tf-open'
        );
    }

    function closeCombatSessionHistory() {
        combatHistoryWindow.classList.remove(
            'tf-open'
        );
    }

    function clearCombatSessionHistory() {
        combatSessionHistory = [];
        saveCombatSessionHistory();
        renderCombatSessionHistory();
    }

    // =========================================================
    // PRICE CACHE
    // =========================================================

    let priceCache = {};
    let priceCacheSaveTimer = null;
    let lastQuartermasterSyncAt = 0;
    let lastQuartermasterUpdatedAt = 0;

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
            // Ignore storage failures.
        }
    }

    function schedulePriceCacheSave() {
        if (priceCacheSaveTimer !== null) {
            return;
        }

        priceCacheSaveTimer =
            window.setTimeout(
                () => {
                    priceCacheSaveTimer = null;
                    savePriceCache();
                },
                150
            );
    }

    function getCachedPriceRecord(itemId) {
        const record =
            priceCache[itemId];

        if (
            !record ||
            typeof record !== 'object' ||
            Array.isArray(record)
        ) {
            return {};
        }

        return record;
    }

    function setCachedMarketData(
        itemId,
        patch
    ) {
        if (
            !Number.isFinite(itemId) ||
            itemId <= 0 ||
            !patch ||
            typeof patch !== 'object'
        ) {
            return false;
        }

        const existing =
            getCachedPriceRecord(itemId);

        const next = {
            ...existing,
            itemId,
            name:
                ITEM_NAMES[itemId] ||
                existing.name ||
                ''
        };

        const numericFields = [
            'ask',
            'bid',
            'lastSold',
            'vendorPrice'
        ];

        numericFields.forEach(
            field => {
                if (
                    Object.prototype.hasOwnProperty.call(
                        patch,
                        field
                    )
                ) {
                    const value =
                        Number(patch[field]);

                    next[field] =
                        Number.isFinite(value) &&
                        value > 0
                            ? value
                            : 0;
                }
            }
        );

        [
            'askSource',
            'bidSource',
            'lastSoldSource',
            'vendorSource'
        ].forEach(
            field => {
                if (
                    Object.prototype.hasOwnProperty.call(
                        patch,
                        field
                    )
                ) {
                    next[field] =
                        String(patch[field] || '');
                }
            }
        );

        next.updated =
            Date.now();

        const comparableExisting = {
            ...existing,
            updated: 0
        };

        const comparableNext = {
            ...next,
            updated: 0
        };

        if (
            JSON.stringify(comparableExisting) ===
            JSON.stringify(comparableNext)
        ) {
            return false;
        }

        priceCache[itemId] =
            next;

        schedulePriceCacheSave();

        return true;
    }

    function getCachedPriceResolution(itemId) {
        const record =
            getCachedPriceRecord(itemId);

        const ask =
            Number(record.ask) || 0;

        if (ask > 0) {
            return {
                price: ask,
                source:
                    record.askSource ||
                    'Exchange Listing',
                exact: true
            };
        }

        const lastSold =
            Number(record.lastSold) || 0;

        if (lastSold > 0) {
            return {
                price: lastSold,
                source:
                    record.lastSoldSource ||
                    'Last Sold',
                exact: false
            };
        }

        const vendorPrice =
            Number(record.vendorPrice) ||
            Number(
                BUILT_IN_VENDOR_PRICES[itemId]
            ) ||
            0;

        if (vendorPrice > 0) {
            return {
                price: vendorPrice,
                source:
                    record.vendorSource ||
                    'Vendor',
                exact: false
            };
        }

        return {
            price: 0,
            source: 'Unavailable',
            exact: false
        };
    }

    function getCachedPrice(itemId) {
        return getCachedPriceResolution(
            itemId
        ).price;
    }

    function preloadVendorPrices() {
        Object.entries(
            BUILT_IN_VENDOR_PRICES
        ).forEach(
            ([itemId, vendorPrice]) => {
                setCachedMarketData(
                    Number(itemId),
                    {
                        vendorPrice,
                        vendorSource:
                            'Built-in Vendor'
                    }
                );
            }
        );
    }

    function syncQuartermasterPriceCache(
        force = false
    ) {
        const now =
            Date.now();

        if (
            !force &&
            now - lastQuartermasterSyncAt <
                1500
        ) {
            return 0;
        }

        lastQuartermasterSyncAt =
            now;

        let quartermasterState;

        try {
            quartermasterState =
                JSON.parse(
                    localStorage.getItem(
                        QUARTERMASTER_STORAGE_KEY
                    ) || '{}'
                );
        } catch {
            return 0;
        }

        const updatedAt =
            Number(
                quartermasterState?.updatedAt
            ) || 0;

        if (
            !force &&
            updatedAt > 0 &&
            updatedAt ===
                lastQuartermasterUpdatedAt
        ) {
            return 0;
        }

        lastQuartermasterUpdatedAt =
            updatedAt;

        let captured = 0;

        Object.values(
            quartermasterState?.prices || {}
        ).forEach(
            record => {
                const itemId =
                    ITEM_ID_BY_NAME.get(
                        normalizeItemName(
                            record?.name
                        )
                    );

                if (!itemId) {
                    return;
                }

                const patch = {
                    ask:
                        Number(record.ask) || 0,
                    bid:
                        Number(record.bid) || 0,
                    askSource:
                        'Quartermaster Listing',
                    bidSource:
                        'Quartermaster Buy Order'
                };

                const lastSold =
                    Number(
                        record.lastSold ||
                        record.recentTradeMedian
                    ) || 0;

                const vendorPrice =
                    Number(
                        record.vendorPrice
                    ) || 0;

                if (lastSold > 0) {
                    patch.lastSold = lastSold;
                    patch.lastSoldSource =
                        'Quartermaster Last Sold';
                }

                if (vendorPrice > 0) {
                    patch.vendorPrice = vendorPrice;
                    patch.vendorSource =
                        'Quartermaster Vendor';
                }

                const changed =
                    setCachedMarketData(
                        itemId,
                        patch
                    );

                if (changed) {
                    captured += 1;
                }
            }
        );

        return captured;
    }

    preloadVendorPrices();
    syncQuartermasterPriceCache(true);

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

        /*
         * Tidefall can place the same item ID on both an outer tile
         * and one or more nested HUD nodes while the tile is being
         * rerendered. Read every valid candidate, but keep the highest
         * quantity for an item instead of allowing the final DOM node
         * to overwrite the value with a temporary zero or stale child.
         */
        container
            .querySelectorAll(
                '[data-item-id], [data-item-type]'
            )
            .forEach(
                element => {
                    const itemId =
                        Number(
                            element.dataset.itemId ??
                            element.dataset.itemType
                        );

                    if (
                        !registerCombatHudItem(
                            element,
                            itemId
                        )
                    ) {
                        return;
                    }

                    let quantity = null;

                    const readQuantity =
                        node => {
                            if (!node) {
                                return null;
                            }

                            const raw =
                                node.dataset?.qty ??
                                node.dataset?.quantity;

                            if (
                                raw !== undefined &&
                                raw !== ''
                            ) {
                                const parsed =
                                    Number(raw);

                                if (
                                    Number.isFinite(parsed)
                                ) {
                                    return parsed;
                                }
                            }

                            const text =
                                String(
                                    node.textContent || ''
                                ).trim();

                            if (text) {
                                const parsed =
                                    numberFromText(text);

                                if (
                                    Number.isFinite(parsed)
                                ) {
                                    return parsed;
                                }
                            }

                            return null;
                        };

                    /*
                     * Prefer explicit quantity data on the item node,
                     * then its badge. The badge text is the final
                     * fallback for older Tidefall markup.
                     */
                    const directRaw =
                        element.dataset.qty ??
                        element.dataset.quantity;

                    if (
                        directRaw !== undefined &&
                        directRaw !== ''
                    ) {
                        const parsed =
                            Number(directRaw);

                        if (Number.isFinite(parsed)) {
                            quantity = parsed;
                        }
                    }

                    if (quantity === null) {
                        const badge =
                            element.querySelector(
                                '.mp-badge-count, [data-qty], [data-quantity]'
                            );

                        quantity =
                            readQuantity(badge);
                    }

                    if (
                        quantity === null ||
                        !Number.isFinite(quantity)
                    ) {
                        return;
                    }

                    const existing =
                        quantities.get(itemId);

                    if (
                        existing === undefined ||
                        quantity > existing
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

    /*
     * Cannon condition is shown on the ship's hold slots, not inside
     * the ammo HUD: <div class="sp-hold-slot" data-slot="2"
     * data-ship="336146" data-itemtype="217"><img class=
     * "mp-cannon-condition" title="997 / 2200" ...></div>. Read every
     * such slot directly so wear on all 14 cannons is tracked
     * per-slot, independent of which type is equipped in each.
     */
    function getEquippedCannonSlots() {
        const slots = [];

        document
            .querySelectorAll(
                '.sp-hold-slot[data-itemtype]'
            )
            .forEach(
                slot => {
                    const itemId =
                        Number(
                            slot.dataset.itemtype
                        );

                    if (!CANNON_IDS.has(itemId)) {
                        return;
                    }

                    const conditionElement =
                        slot.querySelector(
                            '.mp-cannon-condition'
                        );

                    if (!conditionElement) {
                        return;
                    }

                    const raw =
                        conditionElement.getAttribute('title') ||
                        conditionElement.getAttribute('aria-label') ||
                        '';

                    const match =
                        raw.match(
                            /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/
                        );

                    if (!match) {
                        return;
                    }

                    const current =
                        Number(match[1].replace(/,/g, ''));

                    const max =
                        Number(match[2].replace(/,/g, ''));

                    if (
                        !Number.isFinite(current) ||
                        !Number.isFinite(max) ||
                        max <= 0
                    ) {
                        return;
                    }

                    const slotKey =
                        `${slot.dataset.ship || ''}:` +
                        `${slot.dataset.slot ?? ''}`;

                    slots.push({
                        slotKey,
                        itemId,
                        current,
                        max
                    });
                }
            );

        return slots;
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
        const quantities =
            getEquippedConsumables();

        for (
            const [itemId, quantity]
            of quantities
        ) {
            if (idSet.has(itemId)) {
                return quantity;
            }
        }

        const container =
            document.querySelector(
                '#combat-ammo-hud-munitions'
            );

        return container
            ? 0
            : null;
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

        setHTMLIfChanged(
            combatWarningContent,
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
                )
        );

        combatWarning.style.display =
            'block';
    }

    // =========================================================
    // HEAL TIMING GLOW (food / repair kit tiles)
    //
    // Glows the equipped food/repair-kit tile so it's obvious at a
    // glance whether now is a good time to consume it:
    //   green  - low enough that healing now uses the item fully (no waste)
    //   yellow - low-ish, but healing now would overheal a bit -- ok, not ideal
    //   red    - critical, heal now regardless of waste
    //   none   - healthy, no need to heal yet
    // =========================================================

    const HEAL_GLOW_ENTER_PCT = 60;    // % and below: glow turns on
    const HEAL_GLOW_CRITICAL_PCT = 25; // % and below: always red, regardless of overheal

    // Tidefall's "quick heal" keeps auto-consuming the item until you're
    // topped off, so a single click can burn through several items --
    // only the LAST one in that chain can be partially wasted, by
    // (healPerUse - (missing % healPerUse)). Green requires that waste to
    // be small relative to the item's own value, not just "does one item
    // fit" -- missing=301 against a 300-value kit still burns a second
    // kit and wastes 299 of it, which the old "does it fit" check missed.
    const HEAL_GLOW_WASTE_MAX_PCT = 15; // waste at/below this % of one item's value -> green

    // Same danger-override logic Combat Tracker uses: look at how hard the
    // enemy's recent hits actually were, and force red if the worst one
    // (within the last INCOMING_HIT_MAX_AGE_MS) could bring you to 0 or
    // below on the next volley -- regardless of the flat % cutoff above.
    // Hits are time-limited so a big critical from a fight that's long
    // over doesn't keep this stuck on.
    // Sized generously so this count cap essentially never binds -- the
    // 30s time window (INCOMING_HIT_MAX_AGE_MS) is meant to be the actual
    // "recent" boundary. A small cap here can silently evict a big crit
    // before its own 30s freshness expires it (e.g. several ordinary hits
    // landing right after it in a fast fight), making the glow forget the
    // worst hit even though it's still well within the window.
    const INCOMING_HIT_LOOKBACK = 50;
    const INCOMING_HIT_MAX_AGE_MS = 30000;

    const INCOMING_HIT_SELECTOR =
        '.log-entry.log-combat.combat-row--incoming-hit[data-sent-at], ' +
        '.log-entry.log-combat.combat-row--incoming-critical[data-sent-at]';

    function getWorstRecentIncomingHit() {
        const now = Date.now();

        const recentEntries =
            Array.from(
                document.querySelectorAll(
                    INCOMING_HIT_SELECTOR
                )
            ).slice(-INCOMING_HIT_LOOKBACK);

        let worstHull = 0;
        let worstCrew = 0;

        recentEntries.forEach(
            entry => {
                const sentAt =
                    Number(entry.dataset.sentAt);

                if (
                    !Number.isFinite(sentAt) ||
                    now - sentAt > INCOMING_HIT_MAX_AGE_MS
                ) {
                    return;
                }

                const hullEl =
                    entry.querySelector('.combat-val--hull');

                const crewEl =
                    entry.querySelector('.combat-val--crew');

                const hull =
                    hullEl
                        ? parseInt(hullEl.textContent, 10)
                        : NaN;

                const crew =
                    crewEl
                        ? parseInt(crewEl.textContent, 10)
                        : NaN;

                if (!Number.isNaN(hull)) {
                    worstHull = Math.max(worstHull, hull);
                }

                if (!Number.isNaN(crew)) {
                    worstCrew = Math.max(worstCrew, crew);
                }
            }
        );

        return { worstHull, worstCrew };
    }

    const HEAL_GLOW_CLASSES = [
        'tf-heal-glow-green',
        'tf-heal-glow-yellow',
        'tf-heal-glow-red'
    ];

    const healGlowStyle =
        document.createElement('style');

    healGlowStyle.textContent = `
        .tf-heal-glow-green,
        .tf-heal-glow-yellow,
        .tf-heal-glow-red {
            position: relative;
            z-index: 1;
            border-radius: 6px;
            animation: tf-heal-glow-pulse 1.6s ease-in-out infinite;
        }

        /*
         * Both an inset ring (always visible, can't be clipped by a
         * parent row with overflow:hidden) and an outset glow (bonus
         * bloom when there's room for it) so the highlight reliably
         * hugs the tile itself regardless of the surrounding layout.
         */
        .tf-heal-glow-green {
            box-shadow:
                inset 0 0 0 2px rgba(90, 210, 90, .95),
                inset 0 0 10px 2px rgba(90, 210, 90, .5),
                0 0 10px 3px rgba(90, 210, 90, .55);
        }

        .tf-heal-glow-yellow {
            box-shadow:
                inset 0 0 0 2px rgba(230, 190, 60, .95),
                inset 0 0 10px 2px rgba(230, 190, 60, .45),
                0 0 10px 3px rgba(230, 190, 60, .5);
        }

        .tf-heal-glow-red {
            box-shadow:
                inset 0 0 0 2px rgba(230, 70, 60, .98),
                inset 0 0 12px 3px rgba(230, 70, 60, .55),
                0 0 12px 4px rgba(230, 70, 60, .7);
            animation-duration: .9s;
        }

        @keyframes tf-heal-glow-pulse {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.3); }
        }
    `;

    document.head.appendChild(
        healGlowStyle
    );

    function parseCurrentMax(text) {
        const match =
            /(\d+)\s*\/\s*(\d+)/.exec(
                text || ''
            );

        if (!match) {
            return null;
        }

        return {
            current: Number(match[1]),
            max: Number(match[2])
        };
    }

    function getHullCurrentMax() {
        const element =
            document.querySelector(
                '#cs-hull-num'
            );

        return element
            ? parseCurrentMax(element.textContent)
            : null;
    }

    function getCrewCurrentMax() {
        const element =
            document.querySelector(
                '#cs-crew-num'
            );

        return element
            ? parseCurrentMax(element.textContent)
            : null;
    }

    function getConsumableTileByIds(idSet) {
        const container =
            document.querySelector(
                '#combat-ammo-hud-munitions'
            );

        if (!container) {
            return null;
        }

        const nodes =
            container.querySelectorAll(
                '[data-item-id], [data-item-type]'
            );

        for (const node of nodes) {
            const itemId =
                Number(
                    node.dataset.itemId ??
                    node.dataset.itemType
                );

            if (idSet.has(itemId)) {
                return node;
            }
        }

        return null;
    }

    function getHealPerUseFromTile(tile, fallback) {
        const title =
            tile?.getAttribute('title') || '';

        const match =
            /\+\s*(\d+)\s*each/i.exec(title);

        return match
            ? Number(match[1])
            : fallback;
    }

    function computeHealGlowState(currentMax, healPerUse, worstIncomingHit, qty) {
        if (qty === null || qty <= 0) {
            return null; // nothing to consume -- can't glow "heal now" for an item you don't have
        }

        if (!currentMax) {
            return null;
        }

        const missing =
            currentMax.max - currentMax.current;

        if (missing <= 0) {
            return null; // already full
        }

        const pct =
            (currentMax.current / currentMax.max) * 100;

        const inDanger =
            worstIncomingHit > 0 &&
            currentMax.current - worstIncomingHit <= 0;

        if (inDanger || pct <= HEAL_GLOW_CRITICAL_PCT) {
            return 'red'; // heal now or risk dying, regardless of waste
        }

        if (pct <= HEAL_GLOW_ENTER_PCT) {
            if (healPerUse <= 0) {
                return 'yellow';
            }

            const remainder =
                missing % healPerUse;

            const overheal =
                remainder === 0
                    ? 0
                    : healPerUse - remainder;

            const wastePct =
                (overheal / healPerUse) * 100;

            return wastePct <= HEAL_GLOW_WASTE_MAX_PCT
                ? 'green'   // quick-heal chain ends on (or very near) a full item, minimal waste
                : 'yellow'; // the chain's last item would be significantly overhealed
        }

        return null; // healthy, no need yet
    }

    function applyHealGlow(tile, state) {
        if (!tile) {
            return;
        }

        tile.classList.remove(
            ...HEAL_GLOW_CLASSES
        );

        if (state) {
            tile.classList.add(
                `tf-heal-glow-${state}`
            );
        }
    }

    function clearAllHealGlow() {
        document
            .querySelectorAll(
                HEAL_GLOW_CLASSES
                    .map(cls => `.${cls}`)
                    .join(', ')
            )
            .forEach(
                element =>
                    element.classList.remove(
                        ...HEAL_GLOW_CLASSES
                    )
            );
    }

    function updateHealGlow() {
        if (!settings.healGlowEnabled) {
            clearAllHealGlow();
            return;
        }

        const { worstHull, worstCrew } =
            getWorstRecentIncomingHit();

        const foodTile =
            getConsumableTileByIds(FOOD_IDS);

        applyHealGlow(
            foodTile,
            computeHealGlowState(
                getCrewCurrentMax(),
                getHealPerUseFromTile(foodTile, 16),
                worstCrew,
                getItemQuantityForIds(FOOD_IDS)
            )
        );

        const repairTile =
            getConsumableTileByIds(REPAIR_IDS);

        applyHealGlow(
            repairTile,
            computeHealGlowState(
                getHullCurrentMax(),
                getHealPerUseFromTile(repairTile, 300),
                worstHull,
                getItemQuantityForIds(REPAIR_IDS)
            )
        );
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

    function directMarketCells(row) {
        const tableCells =
            Array.from(
                row.querySelectorAll(
                    ':scope > td'
                )
            );

        if (tableCells.length > 0) {
            return tableCells;
        }

        return Array.from(
            row.children
        ).filter(
            element =>
                element instanceof HTMLElement &&
                !element.matches(
                    'script, style'
                )
        );
    }

    function marketNumberFromCell(cell) {
        if (!(cell instanceof HTMLElement)) {
            return 0;
        }

        const text =
            String(
                cell.innerText ||
                cell.textContent ||
                ''
            ).trim();

        if (
            !text ||
            /^[—–-]+$/.test(text)
        ) {
            return 0;
        }

        return decimalFromText(text);
    }

    function findMarketHeaderCells(row) {
        const table =
            row.closest('table');

        if (table) {
            const headerRow =
                table.querySelector(
                    'thead tr'
                ) ||
                Array.from(
                    table.querySelectorAll('tr')
                ).find(
                    candidate =>
                        /best ask|best bid|weekly volume/i
                            .test(
                                candidate.innerText || ''
                            )
                );

            if (headerRow) {
                return Array.from(
                    headerRow.querySelectorAll(
                        ':scope > th, :scope > td'
                    )
                );
            }
        }

        return [];
    }

    function buildMarketColumnMap(row) {
        const map = {};

        findMarketHeaderCells(row)
            .forEach(
                (header, index) => {
                    const label =
                        normalizeItemName(
                            header.innerText
                        );

                    if (label.includes('item')) {
                        map.item = index;
                    }

                    if (label.includes('best ask')) {
                        map.ask = index;
                    }

                    if (label.includes('best bid')) {
                        map.bid = index;
                    }

                    if (label.includes('weekly volume')) {
                        map.weeklyVolume = index;
                    }
                }
            );

        return map;
    }

    function detectTrackedMarketItemId(
        row,
        itemCell
    ) {
        const rawId =
            row.getAttribute(
                'data-mkt-item-type-id'
            ) ||
            row.dataset.mktItemTypeId ||
            row.dataset.mktItem ||
            row.dataset.itemId ||
            row.querySelector(
                '[data-mkt-item-type-id]'
            )?.getAttribute(
                'data-mkt-item-type-id'
            ) ||
            '';

        const itemId =
            Number(rawId);

        if (
            Number.isFinite(itemId) &&
            TRACKED_IDS.has(itemId)
        ) {
            return itemId;
        }

        const candidates = [
            itemCell?.dataset?.itemName,
            itemCell?.querySelector(
                '[data-item-name]'
            )?.dataset?.itemName,
            itemCell?.querySelector('img[alt]')?.alt,
            itemCell?.innerText,
            row.querySelector('img[alt]')?.alt,
            row.innerText
        ];

        for (const candidate of candidates) {
            const normalized =
                normalizeItemName(candidate);

            for (
                const [itemName, trackedId]
                of ITEM_ID_BY_NAME
            ) {
                if (
                    normalized === itemName ||
                    normalized.includes(itemName)
                ) {
                    return trackedId;
                }
            }
        }

        return null;
    }

    function scanVisibleExchangePrices() {
        const rows =
            document.querySelectorAll(
                [
                    'tr.mkt-row[data-mkt-item]',
                    'tr.mkt-row',
                    '[data-mkt-item]'
                ].join(',')
            );

        let captured = 0;
        const seen = new Set();

        rows.forEach(
            row => {
                if (
                    !(row instanceof HTMLElement) ||
                    seen.has(row)
                ) {
                    return;
                }

                seen.add(row);

                const cells =
                    directMarketCells(row);

                if (cells.length < 5) {
                    return;
                }

                const map =
                    buildMarketColumnMap(row);

                const hasMappedColumns =
                    Number.isInteger(map.ask) ||
                    Number.isInteger(map.bid);

                const statusText =
                    String(
                        cells[cells.length - 1]
                            ?.innerText || ''
                    );

                const looksLikeSummary =
                    cells.length >= 7 &&
                    /abundant|high supply|low supply|stable/i
                        .test(statusText);

                if (
                    !hasMappedColumns &&
                    !looksLikeSummary
                ) {
                    return;
                }

                const itemIndex =
                    Number.isInteger(map.item)
                        ? map.item
                        : 0;

                const askIndex =
                    Number.isInteger(map.ask)
                        ? map.ask
                        : 1;

                const bidIndex =
                    Number.isInteger(map.bid)
                        ? map.bid
                        : 2;

                const itemId =
                    detectTrackedMarketItemId(
                        row,
                        cells[itemIndex]
                    );

                if (!itemId) {
                    return;
                }

                if (
                    setCachedMarketData(
                        itemId,
                        {
                            ask:
                                marketNumberFromCell(
                                    cells[askIndex]
                                ),
                            bid:
                                marketNumberFromCell(
                                    cells[bidIndex]
                                ),
                            askSource:
                                'Exchange Listing',
                            bidSource:
                                'Exchange Buy Order'
                        }
                    )
                ) {
                    captured += 1;
                }
            }
        );

        return captured;
    }

    function getOpenExchangeItemId() {
        const directId =
            Number(
                document.querySelector(
                    '.mkt-detail-stats [data-mkt-item-type-id], .mkt-detail-page [data-mkt-item-type-id]'
                )?.getAttribute(
                    'data-mkt-item-type-id'
                ) || 0
            );

        if (
            Number.isFinite(directId) &&
            TRACKED_IDS.has(directId)
        ) {
            return directId;
        }

        const breadcrumbs =
            document.querySelector(
                '.mkt-detail-crumbs'
            );

        const text =
            normalizeItemName(
                breadcrumbs?.textContent
            );

        for (
            const [itemName, itemId]
            of ITEM_ID_BY_NAME
        ) {
            if (text.includes(itemName)) {
                return itemId;
            }
        }

        return null;
    }

    function getLastSoldPriceFromOpenItem() {
        const element =
            Array.from(
                document.querySelectorAll(
                    '.mkt-detail-fills-rows .mkt-row .mkt-detail-order-price'
                )
            ).find(
                candidate =>
                    candidate instanceof HTMLElement &&
                    candidate.offsetParent !== null
            );

        const price =
            decimalFromText(
                element?.textContent
            );

        return price > 0
            ? price
            : 0;
    }

    function exactMarketTextElements(
        root,
        wanted
    ) {
        const target =
            normalizeItemName(wanted);

        return Array.from(
            (root || document)
                .querySelectorAll('*')
        ).filter(
            element =>
                element instanceof HTMLElement &&
                element.offsetParent !== null &&
                normalizeItemName(
                    element.textContent
                ) === target
        );
    }

    function marketDetailValueByLabel(
        root,
        label
    ) {
        const labelElement =
            exactMarketTextElements(
                root,
                label
            )[0];

        if (!labelElement) {
            return 0;
        }

        for (
            let container =
                    labelElement.parentElement,
                depth = 0;
            container && depth < 4;
            container =
                container.parentElement,
                depth += 1
        ) {
            const children =
                Array.from(
                    container.children
                ).filter(
                    child =>
                        child instanceof HTMLElement
                );

            const labelIndex =
                children.indexOf(
                    labelElement
                );

            if (labelIndex >= 0) {
                for (
                    let index =
                            labelIndex + 1;
                    index < children.length;
                    index += 1
                ) {
                    const value =
                        decimalFromText(
                            children[index]
                                .innerText
                        );

                    if (value > 0) {
                        return value;
                    }
                }
            }
        }

        return 0;
    }

    function getLowestAskFromOpenItem() {
        const root =
            document.querySelector(
                '#mkt-tab-exchange'
            ) || document;

        const estimatedAsk =
            marketDetailValueByLabel(
                root,
                'ESTIMATED ASK'
            );

        if (estimatedAsk > 0) {
            return estimatedAsk;
        }

        const sellerLabel =
            exactMarketTextElements(
                root,
                'SELLER'
            )[0];

        const buyerLabel =
            exactMarketTextElements(
                root,
                'BUYER'
            )[0];

        if (!sellerLabel) {
            return 0;
        }

        const rows =
            Array.from(
                root.querySelectorAll(
                    'tr, [role="row"], [class*="row"]'
                )
            );

        for (const row of rows) {
            if (!(row instanceof HTMLElement)) {
                continue;
            }

            const afterSeller =
                Boolean(
                    sellerLabel.compareDocumentPosition(
                        row
                    ) &
                    Node.DOCUMENT_POSITION_FOLLOWING
                );

            if (!afterSeller) {
                continue;
            }

            if (buyerLabel) {
                const beforeBuyer =
                    Boolean(
                        row.compareDocumentPosition(
                            buyerLabel
                        ) &
                        Node.DOCUMENT_POSITION_FOLLOWING
                    );

                if (!beforeBuyer) {
                    continue;
                }
            }

            const cells =
                Array.from(
                    row.children
                ).filter(
                    child =>
                        child instanceof HTMLElement &&
                        child.offsetParent !== null &&
                        normalizeItemName(
                            child.innerText
                        )
                );

            if (
                cells.length < 3 ||
                cells.length > 6
            ) {
                continue;
            }

            const preferred =
                decimalFromText(
                    cells[2]?.innerText
                );

            if (preferred > 0) {
                return preferred;
            }
        }

        return 0;
    }

    function getVendorPriceFromOpenItem() {
        const cells =
            Array.from(
                document.querySelectorAll(
                    '.mkt-detail-stats-cell'
                )
            );

        const vendorCell =
            cells.find(
                cell =>
                    normalizeItemName(
                        cell.querySelector(
                            '.mkt-detail-stats-label'
                        )?.textContent
                    ) === 'vendor price'
            );

        return decimalFromText(
            vendorCell?.querySelector(
                '.mkt-detail-stats-val'
            )?.textContent
        );
    }

    function scanOpenExchangeItem() {
        const itemId =
            getOpenExchangeItemId();

        if (!itemId) {
            return false;
        }

        return setCachedMarketData(
            itemId,
            {
                ask:
                    getLowestAskFromOpenItem(),
                lastSold:
                    getLastSoldPriceFromOpenItem(),
                vendorPrice:
                    getVendorPriceFromOpenItem() ||
                    BUILT_IN_VENDOR_PRICES[itemId] ||
                    0,
                askSource:
                    'Exchange Listing',
                lastSoldSource:
                    'Last Sold',
                vendorSource:
                    'Exchange Vendor'
            }
        );
    }

    function scanMarketPrices() {
        syncQuartermasterPriceCache();
        scanVisibleExchangePrices();
        scanOpenExchangeItem();
        checkForMissingPrices();
    }

    // =========================================================
    // COMBAT CONSUMPTION
    // =========================================================

    function initializeItemTracking() {
        lastQuantities.clear();
        pendingItemDecreases.clear();

        const quantities =
            getEquippedConsumables();

        quantities.forEach(
            (quantity, itemId) => {
                lastQuantities.set(
                    itemId,
                    quantity
                );

                const price =
                    getCachedPrice(
                        itemId
                    );

                if (price > 0) {
                    sessionPrices.set(
                        itemId,
                        price
                    );
                }
            }
        );
    }

    function refreshItemBaseline(
        quantities
    ) {
        /*
         * An empty HUD snapshot usually means the combat UI is
         * mounting/unmounting. Do not turn that temporary absence
         * into a quantity of zero.
         */
        if (quantities.size === 0) {
            return;
        }

        lastQuantities.clear();

        quantities.forEach(
            (quantity, itemId) => {
                lastQuantities.set(
                    itemId,
                    quantity
                );
            }
        );
    }

    function recordItemConsumption(
        quantities
    ) {
        let consumptionChanged = false;

        quantities.forEach(
            (quantity, itemId) => {
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

                if (quantity < previous) {
                    const decrease =
                        previous - quantity;

                    consumedItems.set(
                        itemId,
                        (
                            consumedItems.get(
                                itemId
                            ) || 0
                        ) + decrease
                    );

                    consumptionChanged = true;

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
                }

                /*
                 * Commit the live HUD quantity immediately. Because
                 * this scanner only charges while combat is active,
                 * there is no need to wait 750 ms to distinguish a
                 * warehouse transfer from real combat use. Waiting
                 * allowed the HUD to disappear at battle end before
                 * the decrease was ever committed.
                 */
                lastQuantities.set(
                    itemId,
                    quantity
                );

                pendingItemDecreases.delete(
                    itemId
                );
            }
        );

        return consumptionChanged;
    }

    function scanItemConsumption() {
        const inCombat =
            isActuallyInCombat();

        if (inCombat) {
            lastCombatTime =
                Date.now();
        }

        const quantities =
            getEquippedConsumables();

        const withinCombatTrackingGrace =
            lastCombatTime > 0 &&
            Date.now() - lastCombatTime <=
                ITEM_TRACKING_COMBAT_GRACE_MS;

        if (
            !settings.combatTrackerEnabled
        ) {
            if (
                !inCombat &&
                !withinCombatTrackingGrace
            ) {
                refreshItemBaseline(
                    quantities
                );
            }

            pendingItemDecreases.clear();
            return;
        }

        /*
         * A shot can cause Tidefall to rerender or briefly hide the
         * combat HUD. Do not treat that short UI transition as the end
         * of combat, because doing so can replace the old ammo baseline
         * with the post-shot quantity before the decrease is charged.
         */
        if (
            !inCombat &&
            !withinCombatTrackingGrace
        ) {
            refreshItemBaseline(
                quantities
            );

            pendingItemDecreases.clear();
            return;
        }

        /*
         * Auto-start sessions begin when the first victory is found.
         * Track live decreases during that first fight as well, so
         * its ammo, food, and repair usage is already present when the
         * victory starts the visible PvE session.
         */
        if (
            !combatRunning &&
            combatKills > 0
        ) {
            return;
        }

        const changed =
            recordItemConsumption(
                quantities
            );

        if (changed) {
            updateCombatDisplay();
        }
    }

    /*
     * Mirrors scanItemConsumption()/recordItemConsumption() above, but
     * for cannon condition instead of inventory quantity. A condition
     * drop is converted to a fraction of a full cannon (decrease/max)
     * and stored in the shared consumedItems map under the cannon's
     * item ID, so it is priced and folded into net profit exactly like
     * ammo/food/repair kits with zero changes to the cost math below.
     */
    function recordCannonWear(slots) {
        let wearChanged = false;

        slots.forEach(
            ({ slotKey, itemId, current, max }) => {
                if (
                    !lastCannonConditions.has(
                        slotKey
                    )
                ) {
                    lastCannonConditions.set(
                        slotKey,
                        current
                    );

                    return;
                }

                const previous =
                    lastCannonConditions.get(
                        slotKey
                    );

                if (current < previous) {
                    const decrease =
                        previous - current;

                    consumedItems.set(
                        itemId,
                        (
                            consumedItems.get(
                                itemId
                            ) || 0
                        ) +
                        decrease / max
                    );

                    wearChanged = true;

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
                }

                lastCannonConditions.set(
                    slotKey,
                    current
                );
            }
        );

        return wearChanged;
    }

    function scanCannonWear() {
        const inCombat =
            isActuallyInCombat();

        const slots =
            getEquippedCannonSlots();

        const withinCombatTrackingGrace =
            lastCombatTime > 0 &&
            Date.now() - lastCombatTime <=
                ITEM_TRACKING_COMBAT_GRACE_MS;

        if (
            !settings.combatTrackerEnabled
        ) {
            if (
                !inCombat &&
                !withinCombatTrackingGrace
            ) {
                lastCannonConditions.clear();
            }

            return;
        }

        if (
            !inCombat &&
            !withinCombatTrackingGrace
        ) {
            lastCannonConditions.clear();
            return;
        }

        if (
            !combatRunning &&
            combatKills > 0
        ) {
            return;
        }

        const changed =
            recordCannonWear(
                slots
            );

        if (changed) {
            updateCombatDisplay();
        }
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

    function getCannonWearCost() {
        return getConsumedCostForIds(
            CANNON_IDS
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

    function getCombatHours() {
        return Math.max(
            getCombatSessionDurationSeconds() / 3600,
            1 / 3600
        );
    }

    function getCombatPerHourValue() {
        const hours =
            getCombatHours();

        return settings.combatPerHourMetric === 'gross'
            ? combatGrossGold / hours
            : (combatGrossGold - getConsumableCost()) / hours;
    }

    function getCombatPerHourLabel() {
        return settings.combatPerHourMetric === 'gross'
            ? 'Profit / hr'
            : 'Net Profit / hr';
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
        setTextIfChanged(
            costGrossElement,
            `+${Math.round(
                combatGrossGold
            ).toLocaleString()}`
        );

        setTextIfChanged(
            costAmmoElement,
            `-${Math.round(
                getAmmoCost()
            ).toLocaleString()}`
        );

        setTextIfChanged(
            costFoodElement,
            `-${Math.round(
                getFoodCost()
            ).toLocaleString()}`
        );

        setTextIfChanged(
            costRepairsElement,
            `-${Math.round(
                getRepairCost()
            ).toLocaleString()}`
        );

        setTextIfChanged(
            costCannonElement,
            `-${Math.round(
                getCannonWearCost()
            ).toLocaleString()}`
        );

        setTextIfChanged(
            costNetElement,
            net.toLocaleString()
        );
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

    function getCurrentCombatAmmoName() {
        const equipped =
            getEquippedConsumables();

        let bestName = '';
        let bestQuantity = -1;

        equipped.forEach(
            (quantity, itemId) => {
                if (!AMMO_IDS.has(itemId)) {
                    return;
                }

                const amount =
                    Number(quantity) || 0;

                if (amount > bestQuantity) {
                    bestQuantity = amount;
                    bestName =
                        ITEM_NAMES[itemId] ||
                        `Ammo ${itemId}`;
                }
            }
        );

        return bestName;
    }

    function updateDamageWindowDisplay() {
        if (!damageWindow) return;

        const average = getCombatAverageHit();
        const accuracy = getCombatAccuracy();

        setTextIfChanged(
            damageDpsElement,
            combatDamageHits > 0
                ? Math.round(average).toLocaleString()
                : '—'
        );
        setTextIfChanged(
            damageAverageElement,
            combatDamageHits > 0
                ? Math.round(average).toLocaleString()
                : '—'
        );
        setTextIfChanged(
            damageMinElement,
            combatDamageHits > 0 && Number.isFinite(combatDamageMin)
                ? Math.round(combatDamageMin).toLocaleString()
                : '—'
        );
        setTextIfChanged(
            damageMaxElement,
            combatDamageHits > 0
                ? Math.round(combatDamageMax).toLocaleString()
                : '—'
        );
        setTextIfChanged(
            damageTotalElement,
            Math.round(combatDamageTotal).toLocaleString()
        );
        setTextIfChanged(
            damageAmmoElement,
            getCurrentCombatAmmoName() || '—'
        );
        setTextIfChanged(
            damageHitsElement,
            combatDamageHits.toLocaleString()
        );
        setTextIfChanged(
            damageMissesElement,
            combatDamageMisses.toLocaleString()
        );
        setTextIfChanged(
            damageAccuracyElement,
            Number.isFinite(accuracy)
                ? `${accuracy.toFixed(1)}%`
                : '—'
        );
    }

    function openDamageWindow() {
        if (!settings.combatDamageTrackerEnabled) {
            return;
        }

        damageWindow.classList.add('tf-open');
        damageWindow.style.display = 'block';
        damageWindow.style.zIndex = '10000000';
        updateDamageWindowDisplay();
    }

    function closeDamageWindow() {
        damageWindow.classList.remove('tf-open');
        damageWindow.style.display = 'none';
    }

    function updateCombatDisplay() {
        updateCombatDamageClock();
        updateDamageWindowDisplay();

        setTextIfChanged(
            killsElement,
            combatKills.toLocaleString()
        );

        setTextIfChanged(
            xpGainedElement,
            combatTotalXP.toLocaleString()
        );

        const level =
            getSkillLevel(
                'gunnery'
            );

        setTextIfChanged(
            killsLevelLabel,
            level !== null
                ? `Kills to Level ${level + 1}`
                : 'Kills to Level'
        );

        const killsRemaining =
            getKillsToLevel();

        setTextIfChanged(
            killsToLevelElement,
            killsRemaining === null
                ? '—'
                : killsRemaining
                    .toLocaleString()
        );

        const net =
            Math.round(
                combatGrossGold -
                getConsumableCost()
            );

        const netText =
            `${net.toLocaleString()} `;

        if (
            netGoldElement.childNodes[0] &&
            netGoldElement.childNodes[0]
                .textContent !== netText
        ) {
            netGoldElement.childNodes[0]
                .textContent =
                netText;
        }

        updateCostWindowDisplay(
            net
        );

        const nextTitle =
            [
                `Gold earned: ${Math.round(combatGrossGold).toLocaleString()}`,
                `Consumables: -${Math.round(getConsumableCost()).toLocaleString()}`,
                `Net gold: ${net.toLocaleString()}`
            ].join('\n');

        if (
            netGoldElement.title !==
            nextTitle
        ) {
            netGoldElement.title =
                nextTitle;
        }

        setDisplayIfChanged(
            netGoldRow,
            settings.combatShowNetGold
                ? ''
                : 'none'
        );

        setTextIfChanged(
            perHourLabelElement,
            getCombatPerHourLabel()
        );

        setTextIfChanged(
            perHourValueElement,
            formatSignedRate(getCombatPerHourValue())
        );

        /*
         * This is the single once-per-second header refresh. The old
         * build also scheduled both header functions independently,
         * causing three overlapping 1-second render paths.
         */
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
            /*
             * A one-shot kill can add the outgoing-damage entry and victory
             * entry in the same Tidefall render. scanVictories() intentionally
             * reads damage first, so do not wipe a hit/miss that was captured
             * moments before this first victory starts the visible session.
             */
            const openingDamageAlreadyCaptured =
                combatDamageHits > 0 ||
                combatDamageMisses > 0 ||
                combatDamageTotal > 0;

            combatRunning = true;
            combatSessionStartedAt = Date.now();
            combatHistoryArchivedCurrentSession = false;

            if (!openingDamageAlreadyCaptured) {
                resetCombatDamageSession();
            } else {
                /* Start the DPS clock now if Tidefall already removed the
                 * combat HUD before the opening one-shot was parsed. */
                if (!combatDamageActiveStartedAt && combatDamageActiveMs <= 0) {
                    combatDamageActiveMs = 1000;
                }
                updateDamageWindowDisplay();
            }

            if (lastQuantities.size === 0) {
                initializeItemTracking();
            } else {
                pendingItemDecreases.clear();

                getEquippedConsumables()
                    .forEach(
                        (quantity, itemId) => {
                            const price =
                                getCachedPrice(itemId);

                            if (
                                quantity > 0 &&
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
        /*
         * Read damage first. The first observed hit can establish the
         * session before a victory message arrives, preserving the opening
         * volley instead of resetting it when the first kill is detected.
         */
        scanDamageEvents();

        getVictoryEntries()
            .forEach(
                processVictory
            );
    }

    function resetCombatSession() {
        archiveCombatSession();

        combatRunning =
            false;

        combatKills = 0;
        combatTotalXP = 0;
        combatGrossGold = 0;
        combatSessionStartedAt = 0;
        combatHistoryArchivedCurrentSession = false;

        resetCombatDamageSession();

        consumedItems.clear();
        sessionPrices.clear();
        lastQuantities.clear();
        lastCannonConditions.clear();
        pendingItemDecreases.clear();


        processedVictories.clear();
        markCurrentVictoriesProcessed();

        lastCombatTime =
            0;

        closeCostWindow();
        closeDamageWindow();

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

    damageWindowClose.addEventListener(
        'click',
        closeDamageWindow
    );

    startStopButton.addEventListener(
        'click',
        () => {

            if (combatRunning) {
                archiveCombatSession();

                combatRunning =
                    false;
            } else {
                archiveCombatSession();

                combatKills = 0;
                combatTotalXP = 0;
                combatGrossGold = 0;
                combatSessionStartedAt = Date.now();
                combatHistoryArchivedCurrentSession = false;

                resetCombatDamageSession();

                consumedItems.clear();
                sessionPrices.clear();
                lastQuantities.clear();
                lastCannonConditions.clear();
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

    combatHistoryButton.addEventListener(
        'click',
        openCombatSessionHistory
    );

    combatHistoryCloseButton.addEventListener(
        'click',
        closeCombatSessionHistory
    );

    combatHistoryClearButton.addEventListener(
        'click',
        clearCombatSessionHistory
    );

    queueFinishedToast.addEventListener(
        'click',
        () => {
            queueFinishedToast.classList.remove(
                'tf-open'
            );
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

    let activityXPSamples = [];

    function resetActivityXPSamples() {
        activityXPSamples = [
            {
                at: Date.now(),
                totalXP: 0
            }
        ];
    }

    function recordActivityXPSample() {
        const now = Date.now();
        const last =
            activityXPSamples[
                activityXPSamples.length - 1
            ];

        if (
            last &&
            last.totalXP === activityTotalXP &&
            now - last.at < 1000
        ) {
            return;
        }

        activityXPSamples.push({
            at: now,
            totalXP: activityTotalXP
        });

        const cutoff =
            now - 65 * 60 * 1000;

        while (
            activityXPSamples.length > 2 &&
            activityXPSamples[1].at < cutoff
        ) {
            activityXPSamples.shift();
        }
    }

    function getActualActivityXPPerHour() {
        if (
            !activityStarted ||
            activityStartTime <= 0 ||
            activityTotalXP <= 0
        ) {
            return null;
        }

        const elapsedSeconds =
            (Date.now() - activityStartTime) /
            1000;

        if (elapsedSeconds <= 0) {
            return null;
        }

        return (
            activityTotalXP /
            elapsedSeconds *
            3600
        );
    }

    function getRollingActivityXPPerHour(
        windowSeconds
    ) {
        if (
            !activityStarted ||
            activityTotalXP <= 0 ||
            activityXPSamples.length === 0
        ) {
            return null;
        }

        const now = Date.now();
        const target =
            now - windowSeconds * 1000;
        let baseline =
            activityXPSamples[0];

        for (
            const sample
            of activityXPSamples
        ) {
            if (sample.at <= target) {
                baseline = sample;
            } else {
                break;
            }
        }

        const elapsedSeconds =
            (now - baseline.at) /
            1000;
        const gained =
            activityTotalXP -
            Number(baseline.totalXP || 0);

        if (
            elapsedSeconds <= 0 ||
            gained <= 0
        ) {
            return null;
        }

        return gained /
            elapsedSeconds *
            3600;
    }

    function getTheoreticalActivityXPPerHour() {
        if (
            !activityStarted ||
            !activityTaskName
        ) {
            return null;
        }

        const base =
            getBaseActivityRecipe(
                activityTaskName
            );

        if (base) {
            const modifiers =
                getCurrentProfessionModifiers();
            let masteryXP =
                modifiers.masteryXP;

            if (
                activityActions > 0 &&
                activityTotalXP > 0
            ) {
                const currentSessionXPPerAction =
                    activityTotalXP /
                    activityActions;

                masteryXP =
                    Math.max(
                        0,
                        Math.min(
                            9,
                            Math.round(
                                currentSessionXPPerAction -
                                base.xp
                            )
                        )
                    );
            }

            const cycleSeconds =
                base.seconds *
                modifiers.speedMultiplier;
            const xpPerAction =
                base.xp + masteryXP;

            if (
                Number.isFinite(cycleSeconds) &&
                cycleSeconds > 0 &&
                Number.isFinite(xpPerAction) &&
                xpPerAction > 0
            ) {
                return (
                    3600 /
                    cycleSeconds *
                    xpPerAction
                );
            }
        }

        const stats =
            getPredictedTaskStats(
                activityTaskName
            );

        if (
            !stats ||
            !Number.isFinite(
                stats.xpPerAction
            ) ||
            stats.xpPerAction <= 0 ||
            !Number.isFinite(
                stats.cycleSeconds
            ) ||
            stats.cycleSeconds <= 0
        ) {
            return activityEstimatedXPPerHour;
        }

        return (
            3600 /
            stats.cycleSeconds *
            stats.xpPerAction
        );
    }

    function getActivityXPRateSnapshot() {
        const theoretical =
            getTheoreticalActivityXPPerHour();
        const actual =
            getActualActivityXPPerHour();
        const rolling5m =
            getRollingActivityXPPerHour(
                5 * 60
            );
        const rolling15m =
            getRollingActivityXPPerHour(
                15 * 60
            );
        const rolling1h =
            getRollingActivityXPPerHour(
                60 * 60
            );
        const efficiency =
            Number.isFinite(actual) &&
            Number.isFinite(theoretical) &&
            theoretical > 0
                ? actual /
                    theoretical *
                    100
                : null;

        return {
            theoretical,
            actual,
            rolling5m,
            rolling15m,
            rolling1h,
            efficiency
        };
    }

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
                    /(\d+(?:\.\d+)?)\s*s/i
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

        activityXPSamples = [];

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

        resetActivityXPSamples();

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

    function activityRewardMatchesCurrentTask(
        itemName
    ) {
        const reward =
            normalizeActivityKeyPart(
                itemName
            );

        const task =
            normalizeActivityKeyPart(
                activityTaskName
            );

        if (!reward || !task) {
            return false;
        }

        return (
            reward === task ||
            task.endsWith(`_${reward}`) ||
            reward.endsWith(`_${task}`)
        );
    }

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

        const itemName =
            match[2]?.trim() || '';

        if (
            !Number.isFinite(
                quantity
            ) ||
            quantity <= 0 ||
            !activityRewardMatchesCurrentTask(
                itemName
            )
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
                            ) ||
                            isFirstMateOwnedNode(
                                node
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

            recordActivityXPSample();
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
             * The legacy window layout reopens the Activity Session after a
             * completed action. In header layout this caused the floating
             * Activity Session window to flash briefly over Tidefall's native
             * activity panel every cycle, so never reopen that window here.
             */
            if (
                settings.activitySessionLayout !==
                    'header'
            ) {
                activityPanelClosed =
                    false;
            }

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
                    settings.activitySessionLayout !==
                        'header' &&
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

        const currentStats =
            getCurrentEffectiveActivityStats();

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
                    currentStats.xpPerAction
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
        const remainingXP =
            getActivityRemainingXP();

        const currentStats =
            getCurrentEffectiveActivityStats();

        if (
            !Number.isFinite(remainingXP) ||
            remainingXP <= 0 ||
            !Number.isFinite(currentStats.xpPerAction) ||
            currentStats.xpPerAction <= 0 ||
            !Number.isFinite(currentStats.cycleSeconds) ||
            currentStats.cycleSeconds <= 0
        ) {
            return activityEstimatedTimeToLevel;
        }

        const actionsToLevel =
            Math.ceil(
                remainingXP /
                currentStats.xpPerAction
            );

        const currentCountdown =
            getActivityCycleCountdown();

        const firstActionSeconds =
            Number.isFinite(currentCountdown) &&
            currentCountdown >= 0
                ? currentCountdown
                : currentStats.cycleSeconds;

        return (
            firstActionSeconds +
            Math.max(
                0,
                actionsToLevel - 1
            ) *
            currentStats.cycleSeconds
        );
    }

    function updateActivityLevelEstimate() {
        if (
            !activityStarted ||
            !activitySkill
        ) {
            return;
        }

        const currentStats =
            getCurrentEffectiveActivityStats();

        if (
            !Number.isFinite(currentStats.xpPerAction) ||
            currentStats.xpPerAction <= 0
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
                currentStats.xpPerAction
            );

        if (
            Number.isFinite(currentStats.cycleSeconds) &&
            currentStats.cycleSeconds > 0
        ) {
            activityEstimatedTimeToLevel =
                activityEstimatedActionsToLevel *
                currentStats.cycleSeconds;
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
    let cachedQueuedActivitiesOrdered = [];

    let cachedQueueBadgeCount = 0;

    /*
     * Tidefall can briefly remove and rebuild queue UI while it
     * promotes an entry. Preserve the countdown only across that
     * short handoff, not for the entire final promoted task.
     */
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

    let queueLastConfirmedWaitingCount =
        0;

    let queueUiSettleUntil =
        0;

    const QUEUE_TRANSITION_GRACE_MS =
        15000;

    const QUEUE_UI_SETTLE_MS =
        2000;

    function isQueueBadgeVisible(badge) {
        if (!(badge instanceof HTMLElement)) {
            return false;
        }

        const computed =
            window.getComputedStyle(badge);

        return (
            !badge.hidden &&
            computed.display !== 'none' &&
            computed.visibility !== 'hidden' &&
            computed.opacity !== '0' &&
            badge.getClientRects().length > 0
        );
    }

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
            !isQueueBadgeVisible(badge) ||
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
            cachedQueuedActivitiesOrdered =
                liveEntries.map(entry => ({
                    ...entry
                }));

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
            cachedQueuedActivitiesOrdered = [];
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

        /*
         * Current-session XP takes priority over saved history. Mastery can
         * change between sessions, so a historical XP/action value may be
         * stale and would make Time to Level substantially too long/short.
         */
        let observedXP =
            activityActions > 0 &&
            activityTotalXP > 0
                ? activityTotalXP /
                    activityActions
                : activityEstimatedXPPerAction;

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

    function getCurrentEffectiveActivityStats() {
        const predicted =
            getPredictedTaskStats(
                activityTaskName
            );

        let xpPerAction =
            Number(predicted?.xpPerAction);

        /*
         * Once this session has completed actions, its observed XP/action is
         * the most reliable source because it already includes the player's
         * current XP mastery allocation.
         */
        if (
            activityActions > 0 &&
            activityTotalXP > 0
        ) {
            const sessionXPPerAction =
                activityTotalXP /
                activityActions;

            if (
                Number.isFinite(sessionXPPerAction) &&
                sessionXPPerAction > 0
            ) {
                xpPerAction =
                    sessionXPPerAction;
            }
        }

        let cycleSeconds =
            Number(predicted?.cycleSeconds);

        /*
         * The active-task end timer contains Tidefall's current city-speed
         * modifier. getCurrentProfessionModifiers() derives an effective
         * fractional cycle from it, avoiding the whole-second countdown loss.
         */
        const base =
            getBaseActivityRecipe(
                activityTaskName
            );

        if (base) {
            const modifiers =
                getCurrentProfessionModifiers();

            const modifierCycle =
                base.seconds *
                modifiers.speedMultiplier;

            if (
                Number.isFinite(modifierCycle) &&
                modifierCycle > 0
            ) {
                cycleSeconds =
                    modifierCycle;
            }
        }

        if (
            !Number.isFinite(xpPerAction) ||
            xpPerAction <= 0
        ) {
            xpPerAction =
                activityEstimatedXPPerAction;
        }

        if (
            !Number.isFinite(cycleSeconds) ||
            cycleSeconds <= 0
        ) {
            cycleSeconds =
                activityCycleSeconds;
        }

        return {
            xpPerAction,
            cycleSeconds,
            source:
                predicted?.source ||
                'activity-estimate'
        };
    }

    function getQueuedTimeToLevelEstimate() {
        const currentStats =
            getCurrentEffectiveActivityStats();

        if (
            !Number.isFinite(currentStats.xpPerAction) ||
            currentStats.xpPerAction <= 0 ||
            !Number.isFinite(currentStats.cycleSeconds) ||
            currentStats.cycleSeconds <= 0
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

            const cyclesNeeded =
                Math.ceil(
                    remainingXP /
                    activityEstimatedXPPerAction
                );

            const cyclesUsed =
                Math.min(
                    currentCycles,
                    cyclesNeeded
                );

            if (cyclesUsed > 0) {
                totalSeconds +=
                    (
                        Number.isFinite(
                            currentCountdown
                        ) &&
                        currentCountdown >= 0
                            ? currentCountdown
                            : currentStats.cycleSeconds
                    ) +
                    Math.max(
                        0,
                        cyclesUsed - 1
                    ) *
                    currentStats.cycleSeconds;

                remainingXP -=
                    cyclesUsed *
                    currentStats.xpPerAction;

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

            /*
             * The previous implementation iterated once for every queued
             * cycle. Large crafting queues could therefore execute tens of
             * thousands of loop iterations every display refresh.
             */
            const cyclesNeeded =
                xpPerAction > 0
                    ? Math.ceil(
                        remainingXP /
                        xpPerAction
                    )
                    : cycles;

            const cyclesUsed =
                Math.min(
                    cycles,
                    cyclesNeeded
                );

            totalSeconds +=
                cyclesUsed *
                secondsPerCycle;

            remainingXP -=
                cyclesUsed *
                xpPerAction;

            if (remainingXP <= 0) {
                return totalSeconds;
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
                currentStats.xpPerAction
            ) *
            currentStats.cycleSeconds;
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

        /*
         * Keep the latest debug snapshot in memory, but do not mutate
         * the hidden developer panel while the debugger is disabled.
         * The old behavior produced a changing hidden DOM write every
         * second during queued activities.
         */
        if (!settings.queueDebuggerEnabled) {
            return;
        }

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

        setTextIfChanged(
            queueDebugContent,
            nextText
        );
    }

    function getQueueRemainingEstimate() {
        hydrateQueueRowsIfNeeded();

        const badge =
            document.querySelector(
                '#task-queue-badge'
            );

        const queueBadgeVisible =
            isQueueBadgeVisible(badge);

        const queueCount =
            queueBadgeVisible
                ? numberFromText(
                    badge?.textContent
                )
                : 0;

        const rows =
            getQueuedActivitySnapshot(
                queueCount
            );

        const hasWaitingQueue =
            Boolean(
                queueBadgeVisible &&
                queueCount > 0 &&
                rows.length > 0
            );

        if (hasWaitingQueue) {
            queueLastConfirmedWaitingCount =
                queueCount;

            queueUiSettleUntil =
                Date.now() +
                QUEUE_UI_SETTLE_MS;

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
                `active:${currentCanonical}:${currentCycles ?? 0}`
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

            queueTransitionGraceUntil =
                0;

            queueTransitionHoldSeconds =
                0;

            queueTransitionHoldStartedAt =
                0;

            queueLastConfirmedWaitingCount =
                0;

            queueUiSettleUntil =
                0;

            return null;
        }

        const currentCanonical =
            normalizeActivityKeyPart(
                getCanonicalActivityTaskName(
                    currentActivity.taskName
                )
            );

        /*
         * When more than one task was waiting, Tidefall can mount the
         * new active task a moment before it restores the reduced queue
         * badge and rows. Preserve the estimate only for that short UI
         * settling window. A final promoted task, or a queue changed by
         * deleting its first entry, must stop displaying Queue Remaining
         * once no waiting entries remain.
         */
        if (
            queueLastConfirmedWaitingCount > 1 &&
            Date.now() <= queueUiSettleUntil &&
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
                    `queue-ui-settle:${currentCanonical}`
            };
        }

        queueTransitionGraceUntil =
            0;

        queueTransitionHoldSeconds =
            0;

        queueTransitionHoldStartedAt =
            0;

        queueLastConfirmedWaitingCount =
            0;

        queueUiSettleUntil =
            0;

        return null;
    }

    function getQueueCompletionDetails() {
        const currentActivity =
            getCurrentActivity();

        if (!currentActivity) {
            return null;
        }

        const activeExactSeconds =
            getTaskEndRemainingSeconds();
        const activeSeconds =
            Number.isFinite(activeExactSeconds) &&
            activeExactSeconds > 0
                ? activeExactSeconds
                : getCurrentTaskRemainingSeconds();

        if (
            !Number.isFinite(activeSeconds) ||
            activeSeconds <= 0
        ) {
            return null;
        }

        const now = Date.now();
        let cumulativeSeconds =
            activeSeconds;
        let approximate =
            !Number.isFinite(activeExactSeconds) ||
            activeExactSeconds <= 0;

        const details = [
            {
                taskName:
                    currentActivity.taskName,
                cycles:
                    getActivityCyclesLeft(),
                active: true,
                durationSeconds:
                    activeSeconds,
                endsAt:
                    now + activeSeconds * 1000
            }
        ];

        const badge =
            document.querySelector(
                '#task-queue-badge'
            );
        const queueCount =
            isQueueBadgeVisible(badge)
                ? numberFromText(
                    badge?.textContent
                )
                : 0;
        const groupedRows =
            getQueuedActivitySnapshot(
                queueCount
            );
        const rows =
            cachedQueuedActivitiesOrdered.length > 0
                ? cachedQueuedActivitiesOrdered
                : groupedRows;

        rows.forEach(row => {
            const cycles =
                getQueuedCycleCount(row);
            const taskName =
                getQueuedTaskName(row);

            if (
                !taskName ||
                cycles <= 0
            ) {
                return;
            }

            const stats =
                getPredictedTaskStats(
                    taskName
                );
            let cycleSeconds =
                stats?.cycleSeconds;

            if (
                !Number.isFinite(cycleSeconds) ||
                cycleSeconds <= 0
            ) {
                cycleSeconds =
                    activityCycleSeconds;
                approximate = true;
            } else if (
                stats?.source !==
                    'observed' &&
                stats?.source !==
                    'current-city-adjusted'
            ) {
                approximate = true;
            }

            if (
                !Number.isFinite(cycleSeconds) ||
                cycleSeconds <= 0
            ) {
                return;
            }

            const durationSeconds =
                cycles * cycleSeconds;

            cumulativeSeconds +=
                durationSeconds;

            details.push({
                taskName,
                cycles,
                active: false,
                durationSeconds,
                endsAt:
                    now +
                    cumulativeSeconds * 1000
            });
        });

        return {
            details,
            totalSeconds:
                cumulativeSeconds,
            endsAt:
                now +
                cumulativeSeconds * 1000,
            approximate
        };
    }

    let queueNotificationArmed = false;
    let queueNotificationTargetAt = 0;
    let queueNotificationExpectedFinalTask = '';
    let queueNotificationFinalTaskSeen = false;
    let queueNotificationLastEstimateAt = 0;
    let queueNotificationToastTimer = null;

    function clearQueueNotificationState() {
        queueNotificationArmed = false;
        queueNotificationTargetAt = 0;
        queueNotificationExpectedFinalTask = '';
        queueNotificationFinalTaskSeen = false;
        queueNotificationLastEstimateAt = 0;
    }

    function showQueueFinishedNotification() {
        /*
         * Queue completion uses the same in-game warning treatment as the
         * Low Hull warning. It intentionally does not request or create a
         * browser/OS notification. The banner stays visible until clicked.
         */
        queueFinishedToast.classList.add(
            'tf-open'
        );
    }

    function updateQueueFinishedNotification(
        estimate
    ) {
        if (
            !settings.queueFinishedNotificationEnabled
        ) {
            clearQueueNotificationState();
            return;
        }

        const now = Date.now();

        if (
            estimate &&
            Number.isFinite(estimate.seconds) &&
            estimate.seconds > 0
        ) {
            const queued =
                cachedQueuedActivitiesOrdered.length > 0
                    ? cachedQueuedActivitiesOrdered
                    : cachedQueuedActivities;
            const finalQueued =
                queued[
                    queued.length - 1
                ];

            queueNotificationArmed = true;
            queueNotificationTargetAt =
                now +
                estimate.seconds * 1000;
            queueNotificationLastEstimateAt =
                now;

            if (finalQueued?.taskName) {
                const nextExpectedFinalTask =
                    normalizeActivityKeyPart(
                        getCanonicalActivityTaskName(
                            finalQueued.taskName
                        )
                    );

                if (
                    nextExpectedFinalTask !==
                    queueNotificationExpectedFinalTask
                ) {
                    queueNotificationFinalTaskSeen =
                        false;
                }

                queueNotificationExpectedFinalTask =
                    nextExpectedFinalTask;
            }

            return;
        }

        if (!queueNotificationArmed) {
            return;
        }

        const currentActivity =
            getCurrentActivity();
        const currentCanonical =
            currentActivity
                ? normalizeActivityKeyPart(
                    getCanonicalActivityTaskName(
                        currentActivity.taskName
                    )
                )
                : '';
        const estimateMissingFor =
            now -
            queueNotificationLastEstimateAt;

        if (
            currentActivity &&
            queueNotificationExpectedFinalTask &&
            currentCanonical ===
                queueNotificationExpectedFinalTask
        ) {
            queueNotificationFinalTaskSeen =
                true;
        }

        if (
            now < queueNotificationTargetAt
        ) {
            if (
                estimateMissingFor >
                    QUEUE_TRANSITION_GRACE_MS &&
                (
                    !currentActivity ||
                    (
                        queueNotificationExpectedFinalTask &&
                        currentCanonical !==
                            queueNotificationExpectedFinalTask
                    )
                )
            ) {
                clearQueueNotificationState();
            }

            return;
        }

        if (
            currentActivity &&
            queueNotificationExpectedFinalTask &&
            currentCanonical ===
                queueNotificationExpectedFinalTask
        ) {
            return;
        }

        if (
            currentActivity &&
            queueNotificationExpectedFinalTask &&
            currentCanonical !==
                queueNotificationExpectedFinalTask
        ) {
            clearQueueNotificationState();
            return;
        }

        if (
            queueNotificationExpectedFinalTask &&
            !queueNotificationFinalTaskSeen
        ) {
            clearQueueNotificationState();
            return;
        }

        showQueueFinishedNotification();
        clearQueueNotificationState();
    }

    function updateQueueRemainingDisplay() {
        if (
            !settings.activityQueueRemaining
        ) {
            if (
                settings.queueFinishedNotificationEnabled
            ) {
                updateQueueFinishedNotification(
                    getQueueRemainingEstimate()
                );
            }

            setDisplayIfChanged(
                activityQueueRow,
                'none'
            );

            setTextIfChanged(
                activityQueueRemainingElement,
                '—'
            );

            queueCountdownSignature =
                '';

            queueCountdownBaseSeconds =
                0;

            queueCountdownStartedAt =
                0;

            return null;
        }

        const estimate =
            getQueueRemainingEstimate();

        updateQueueFinishedNotification(
            estimate
        );

        if (!estimate) {
            setDisplayIfChanged(
                activityQueueRow,
                'none'
            );

            setTextIfChanged(
                activityQueueRemainingElement,
                '—'
            );

            queueCountdownSignature =
                '';

            queueCountdownBaseSeconds =
                0;

            queueCountdownStartedAt =
                0;

            queueCountdownApproximate =
                false;

            return null;
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
            setDisplayIfChanged(
                activityQueueRow,
                'none'
            );

            setTextIfChanged(
                activityQueueRemainingElement,
                '—'
            );

            /*
             * The old queue row can remain in Tidefall's DOM
             * briefly after it finishes. Allow First Mate to
             * hydrate/read the queue again so a newly-added
             * queue is detected immediately.
             */
            queueHydratedOnce =
                false;

            queueCountdownSignature =
                '';

            queueCountdownBaseSeconds =
                0;

            queueCountdownStartedAt =
                0;

            queueCountdownApproximate =
                false;

            return null;
        }

        setDisplayIfChanged(
            activityQueueRow,
            'grid'
        );

        setTextIfChanged(
            activityQueueRemainingElement,
            `${formatDuration(remainingSeconds)} · Ends ${formatQueueFinishClock(remainingSeconds)}`
        );

        return estimate;
    }

    // =========================================================
    // ACTIVITY DISPLAY
    // =========================================================


    function updateActivityDisplay() {
        updateActivityLevelEstimate();

        const queueEstimate =
            updateQueueRemainingDisplay();

        if (
            !settings
                .activityTrackerEnabled ||
            !activityStarted ||
            activityPanelClosed
        ) {
            setDisplayIfChanged(
                activityPanel,
                'none'
            );

            return;
        }

        if (
            settings.activitySessionLayout ===
                'header'
        ) {
            setDisplayIfChanged(
                activityPanel,
                'none'
            );

            updateActivityHeaderLayout(
                queueEstimate
            );

            return;
        }

        setDisplayIfChanged(
            activityPanel,
            'block'
        );

        const xpRates =
            getActivityXPRateSnapshot();

        setTextIfChanged(
            activityXpHourLabel,
            settings.actualVsTheoreticalXPEnabled
                ? 'Theoretical XP / Hour'
                : 'XP / Hour'
        );

        setTextIfChanged(
            activityXpHourElement,
            settings.actualVsTheoreticalXPEnabled
                ? formatRate(
                    xpRates.theoretical
                )
                : (
                    activityEstimatedXPPerHour ===
                        null
                        ? '—'
                        : Math.round(
                            activityEstimatedXPPerHour
                        ).toLocaleString()
                )
        );

        setDisplayIfChanged(
            activityActualXpRow,
            settings.actualVsTheoreticalXPEnabled
                ? 'grid'
                : 'none'
        );

        setDisplayIfChanged(
            activityXpEfficiencyRow,
            settings.actualVsTheoreticalXPEnabled
                ? 'grid'
                : 'none'
        );

        setTextIfChanged(
            activityActualXpHourElement,
            formatRate(
                xpRates.actual
            )
        );

        setTextIfChanged(
            activityXpEfficiencyElement,
            Number.isFinite(
                xpRates.efficiency
            )
                ? `${xpRates.efficiency.toFixed(1)}%`
                : '—'
        );

        const rollingDisplay =
            settings.rollingXPRatesEnabled
                ? 'grid'
                : 'none';

        setDisplayIfChanged(
            activityRolling5mRow,
            rollingDisplay
        );
        setDisplayIfChanged(
            activityRolling15mRow,
            rollingDisplay
        );
        setDisplayIfChanged(
            activityRolling1hRow,
            rollingDisplay
        );

        setTextIfChanged(
            activityRolling5mElement,
            formatRate(
                xpRates.rolling5m
            )
        );
        setTextIfChanged(
            activityRolling15mElement,
            formatRate(
                xpRates.rolling15m
            )
        );
        setTextIfChanged(
            activityRolling1hElement,
            formatRate(
                xpRates.rolling1h
            )
        );

        setTextIfChanged(
            activityItemsHourElement,
            activityEstimatedItemsPerHour ===
                null
                ? '—'
                : Math.round(
                    activityEstimatedItemsPerHour
                ).toLocaleString()
        );

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

            setTextIfChanged(
                activityLevelLabel,
                activityEstimatedNextLevel !==
                    null
                    ? `${includesQueue ? 'Queued Time' : 'Time'} to Level ${activityEstimatedNextLevel}`
                    : (
                        includesQueue
                            ? 'Queued Time to Level'
                            : 'Time to Level'
                    )
            );

            const liveTimeToLevel =
                includesQueue
                    ? getQueuedTimeToLevelEstimate()
                    : getLiveActivityTimeToLevel();

            setTextIfChanged(
                activityLevelValue,
                liveTimeToLevel ===
                    null
                    ? '—'
                    : formatDuration(
                        liveTimeToLevel
                    )
            );
        } else {
            setTextIfChanged(
                activityLevelLabel,
                activityEstimatedNextLevel !==
                    null
                    ? `Actions to Level ${activityEstimatedNextLevel}`
                    : 'Actions to Level'
            );

            setTextIfChanged(
                activityLevelValue,
                activityEstimatedActionsToLevel ===
                    null
                    ? '—'
                    : activityEstimatedActionsToLevel
                        .toLocaleString()
            );
        }

        setTextIfChanged(
            activitySkillElement,
            `${titleCaseSkill(activitySkill)} • ${activityTaskName}`
        );
    }

    // =========================================================
    // ACTIVITY SCANNER
    // =========================================================

    function scanActivity() {
        if (
            !settings
                .activityTrackerEnabled
        ) {
            setDisplayIfChanged(
                activityPanel,
                'none'
            );

            return;
        }

        const activity =
            getCurrentActivity();

        if (!activity) {
            /*
             * Tidefall briefly removes the active-task DOM while
             * promoting a queued task. Keep whichever Activity layout
             * the user selected mounted during that short handoff.
             * The once-per-second display tick continues the countdown;
             * the 250ms scanner does not need to rerender the UI.
             */
            const preservingQueueTransition =
                settings.activityQueueRemaining &&
                Date.now() <= queueTransitionGraceUntil &&
                queueTransitionHoldSeconds > 0;

            if (!preservingQueueTransition) {
                setDisplayIfChanged(
                    activityPanel,
                    'none'
                );

                setClassEnabled(
                    activityHeaderLayout,
                    'tf-active',
                    false
                );
            }

            return;
        }

        let sessionChanged =
            false;

        if (
            !activityStarted
        ) {
            startActivitySession(
                activity
            );

            sessionChanged =
                true;
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

            sessionChanged =
                true;
        }

        scanActivityCycleDuration();

        scanActivityXP();

        scanActivityActions();

        recalculateActivityEstimates(
            false
        );

        /*
         * Sampling remains at 250ms so cycle resets and XP changes are
         * captured reliably. Rendering is consolidated into the single
         * 1-second display tick below, except when a new session needs
         * to appear immediately.
         */
        if (sessionChanged) {
            updateActivityDisplay();
        }
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
        if (!settings.startupFollowShipEnabled) {
            navigationWasActive = false;
            navigationFollowPending = false;
            return;
        }

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

            <span class="tf-combat-header-stat" data-kind="dps">
                <span class="tf-combat-header-label">DMG</span>
                <span id="tf-header-combat-dps" class="tf-combat-header-value">—</span>
            </span>

            <span class="tf-combat-header-stat" data-kind="gold">
                <span class="tf-combat-header-label">Net Gold</span>
                <span id="tf-header-combat-gold" class="tf-combat-header-value">0</span>
            </span>

            <span class="tf-combat-header-stat" data-kind="perhour">
                <span id="tf-header-combat-perhour-label" class="tf-combat-header-label">Net Profit / hr</span>
                <span id="tf-header-combat-perhour" class="tf-combat-header-value">—</span>
            </span>
        `;

        bar.querySelector(
            '[data-kind="dps"]'
        )?.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopPropagation();

                openDamageWindow();
            }
        );

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

        bar.querySelector(
            '.tf-combat-header-title'
        )?.addEventListener(
            'click',
            event => {
                if (
                    !settings.combatSessionHistoryEnabled
                ) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                openCombatSessionHistory();
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
            setClassEnabled(
                combatHeaderLayout,
                'tf-active',
                false
            );

            updateActivityHeaderLayout();

            return;
        }

        if (!mountCombatHeaderLayout()) {
            return;
        }

        combatHeaderLayout.querySelector(
            '.tf-combat-header-title'
        )?.classList.toggle(
            'tf-history-enabled',
            settings.combatSessionHistoryEnabled
        );

        const combatActive =
            shouldPvEOccupySharedHeader();

        setClassEnabled(
            combatHeaderLayout,
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

        const dpsStat =
            combatHeaderLayout.querySelector(
                '[data-kind="dps"]'
            );

        setDisplayIfChanged(
            dpsStat,
            settings.combatDamageTrackerEnabled
                ? ''
                : 'none'
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-dps'
            ),
            combatDamageHits > 0
                ? Math.round(getCombatAverageHit()).toLocaleString()
                : '—'
        );

        setDisplayIfChanged(
            combatHeaderLayout.querySelector(
                '[data-kind="gold"]'
            ),
            settings.combatShowNetGold
                ? ''
                : 'none'
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-perhour-label'
            ),
            getCombatPerHourLabel()
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-perhour'
            ),
            formatSignedRate(getCombatPerHourValue())
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-kills'
            ),
            combatKills.toLocaleString()
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-xp'
            ),
            combatTotalXP.toLocaleString()
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-level-label'
            ),
            level !== null
                ? `Kills to Level ${level + 1}`
                : 'Kills to Level'
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-level'
            ),
            killsRemaining === null
                ? '—'
                : killsRemaining.toLocaleString()
        );

        setTextIfChanged(
            combatHeaderLayout.querySelector(
                '#tf-header-combat-gold'
            ),
            net.toLocaleString()
        );
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

    let tidefallTopHeaderCache =
        null;

    function findTidefallTopHeader() {
        if (
            tidefallTopHeaderCache?.isConnected
        ) {
            return tidefallTopHeaderCache;
        }

        const candidates =
            Array.from(
                document.querySelectorAll(
                    'header, nav, body > div, body > section'
                )
            );

        tidefallTopHeaderCache =
            candidates.find(
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

        return tidefallTopHeaderCache;
    }

    function appendHeaderTooltipRow(
        tooltip,
        labelText,
        valueText
    ) {
        const row =
            document.createElement('div');
        const label =
            document.createElement('span');
        const value =
            document.createElement('strong');

        row.className =
            'tf-header-tooltip-row';
        label.textContent =
            labelText;
        value.textContent =
            valueText;

        row.append(
            label,
            value
        );
        tooltip.appendChild(row);
    }

    function appendHeaderTooltipTitle(
        tooltip,
        text
    ) {
        const title =
            document.createElement('div');

        title.className =
            'tf-header-tooltip-title';
        title.textContent = text;
        tooltip.appendChild(title);
    }

    function appendHeaderTooltipSubtitle(
        tooltip,
        text
    ) {
        const subtitle =
            document.createElement('div');

        subtitle.className =
            'tf-header-tooltip-subtitle';
        subtitle.textContent = text;
        tooltip.appendChild(subtitle);
    }

    function renderActivityXPRateTooltip() {
        const tooltip =
            document.getElementById(
                'tf-header-xp-tooltip'
            );

        if (!tooltip) {
            return;
        }

        if (
            !settings.actualVsTheoreticalXPEnabled &&
            !settings.rollingXPRatesEnabled
        ) {
            tooltip.replaceChildren();
            tooltip.classList.remove(
                'tf-open'
            );
            return;
        }

        const rates =
            getActivityXPRateSnapshot();

        tooltip.replaceChildren();
        appendHeaderTooltipTitle(
            tooltip,
            'Activity XP Rates'
        );

        if (
            settings.actualVsTheoreticalXPEnabled
        ) {
            appendHeaderTooltipRow(
                tooltip,
                'Theoretical',
                `${formatRate(rates.theoretical)} XP/hr`
            );
            appendHeaderTooltipRow(
                tooltip,
                'Actual Session',
                `${formatRate(rates.actual)} XP/hr`
            );
            appendHeaderTooltipRow(
                tooltip,
                'Efficiency',
                Number.isFinite(rates.efficiency)
                    ? `${rates.efficiency.toFixed(1)}%`
                    : '—'
            );
        }

        if (settings.rollingXPRatesEnabled) {
            appendHeaderTooltipSubtitle(
                tooltip,
                'Rolling'
            );
            appendHeaderTooltipRow(
                tooltip,
                '5 minutes',
                `${formatRate(rates.rolling5m)} XP/hr`
            );
            appendHeaderTooltipRow(
                tooltip,
                '15 minutes',
                `${formatRate(rates.rolling15m)} XP/hr`
            );
            appendHeaderTooltipRow(
                tooltip,
                '1 hour',
                `${formatRate(rates.rolling1h)} XP/hr`
            );
        }
    }

    function renderQueueCompletionTooltip() {
        const tooltip =
            document.getElementById(
                'tf-header-queue-tooltip'
            );

        if (!tooltip) {
            return;
        }

        if (
            !settings.queueCompletionDetailsEnabled ||
            !settings.activityQueueRemaining
        ) {
            tooltip.replaceChildren();
            tooltip.classList.remove(
                'tf-open'
            );
            return;
        }

        const completion =
            getQueueCompletionDetails();

        if (
            !completion ||
            completion.details.length === 0
        ) {
            tooltip.replaceChildren();
            tooltip.classList.remove(
                'tf-open'
            );
            return;
        }

        tooltip.replaceChildren();
        appendHeaderTooltipTitle(
            tooltip,
            completion.approximate
                ? 'Queue Completion · Estimated'
                : 'Queue Completion'
        );

        completion.details.forEach(
            detail => {
                const count =
                    !detail.active &&
                    Number.isFinite(detail.cycles) &&
                    detail.cycles > 0
                        ? ` × ${Math.round(detail.cycles).toLocaleString()}`
                        : '';

                appendHeaderTooltipRow(
                    tooltip,
                    `${detail.taskName}${detail.active ? ' · Active' : count}`,
                    formatCompletionTimeAt(
                        detail.endsAt
                    )
                );
            }
        );

        appendHeaderTooltipSubtitle(
            tooltip,
            'Total Queue'
        );
        appendHeaderTooltipRow(
            tooltip,
            formatDuration(
                completion.totalSeconds
            ),
            `Ends ${formatCompletionTimeAt(completion.endsAt)}`
        );
    }

    function positionHeaderHoverTooltip(
        tooltip,
        anchorElement
    ) {
        if (!tooltip || !anchorElement) {
            return;
        }

        const anchorRect =
            anchorElement.getBoundingClientRect();
        const header =
            findTidefallTopHeader();
        const headerRect =
            header?.getBoundingClientRect?.();

        /*
         * Measure after tf-open is applied. The tooltip is mounted directly
         * under document.body so header overflow/stacking cannot clip it.
         */
        const tooltipWidth =
            tooltip.offsetWidth || 320;
        const tooltipHeight =
            tooltip.offsetHeight || 120;
        const margin = 8;

        const desiredCenterX =
            anchorRect.left +
            anchorRect.width / 2;

        let left =
            desiredCenterX -
            tooltipWidth / 2;

        left = Math.max(
            margin,
            Math.min(
                left,
                window.innerWidth -
                    tooltipWidth -
                    margin
            )
        );

        let top =
            Math.max(
                anchorRect.bottom,
                headerRect?.bottom ||
                    anchorRect.bottom
            ) + 8;

        if (
            top + tooltipHeight >
            window.innerHeight - margin
        ) {
            top = Math.max(
                margin,
                (headerRect?.top ||
                    anchorRect.top) -
                    tooltipHeight -
                    8
            );
        }

        tooltip.style.left =
            `${Math.round(left)}px`;
        tooltip.style.top =
            `${Math.round(top)}px`;
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
                <div id="tf-header-xp-tooltip" class="tf-header-hover-tooltip"></div>
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
                <div id="tf-header-queue-tooltip" class="tf-header-hover-tooltip"></div>
            </span>


            <span id="tf-header-task" class="tf-activity-header-task"></span>
        `;

        const xpStat =
            bar.querySelector(
                '[data-kind="xp"]'
            );
        const xpTooltip =
            bar.querySelector(
                '#tf-header-xp-tooltip'
            );
        const queueStat =
            bar.querySelector(
                '[data-kind="queue"]'
            );
        const queueTooltip =
            bar.querySelector(
                '#tf-header-queue-tooltip'
            );

        /*
         * Tidefall's top header can clip descendants. Mount hover panels at
         * body level and position them below the full header instead.
         */
        if (xpTooltip) {
            document.body.appendChild(
                xpTooltip
            );
        }

        if (queueTooltip) {
            document.body.appendChild(
                queueTooltip
            );
        }

        xpStat?.addEventListener(
            'mouseenter',
            () => {
                if (
                    !settings.actualVsTheoreticalXPEnabled &&
                    !settings.rollingXPRatesEnabled
                ) {
                    return;
                }

                renderActivityXPRateTooltip();
                xpTooltip?.classList.add(
                    'tf-open'
                );
                positionHeaderHoverTooltip(
                    xpTooltip,
                    xpStat
                );
            }
        );

        xpStat?.addEventListener(
            'mouseleave',
            () => {
                xpTooltip?.classList.remove(
                    'tf-open'
                );
            }
        );

        queueStat?.addEventListener(
            'mouseenter',
            () => {
                if (
                    !settings.queueCompletionDetailsEnabled
                ) {
                    return;
                }

                renderQueueCompletionTooltip();
                if (queueTooltip?.childElementCount) {
                    queueTooltip.classList.add(
                        'tf-open'
                    );
                    positionHeaderHoverTooltip(
                        queueTooltip,
                        queueStat
                    );
                }
            }
        );

        queueStat?.addEventListener(
            'mouseleave',
            () => {
                queueTooltip?.classList.remove(
                    'tf-open'
                );
            }
        );

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

    function updateActivityHeaderLayout(
        queueEstimateOverride
    ) {
        if (
            settings.activitySessionLayout !==
                'header'
        ) {
            setClassEnabled(
                activityHeaderLayout,
                'tf-active',
                false
            );
            document.getElementById(
                'tf-header-xp-tooltip'
            )?.classList.remove('tf-open');
            document.getElementById(
                'tf-header-queue-tooltip'
            )?.classList.remove('tf-open');

            return;
        }

        /*
         * Do not mount or scan the page header when there is no Activity
         * session to show. The old build did this once or several times
         * every second even while idle.
         */
        if (
            !settings.activityTrackerEnabled ||
            !activityStarted ||
            activityPanelClosed
        ) {
            setClassEnabled(
                activityHeaderLayout,
                'tf-active',
                false
            );
            document.getElementById(
                'tf-header-xp-tooltip'
            )?.classList.remove('tf-open');
            document.getElementById(
                'tf-header-queue-tooltip'
            )?.classList.remove('tf-open');

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
         * Reuse the queue estimate already calculated by
         * updateActivityDisplay() when available.
         */
        const queueEstimate =
            queueEstimateOverride !==
                undefined
                ? queueEstimateOverride
                : getQueueRemainingEstimate();

        updateQueueFinishedNotification(
            queueEstimate
        );

        const preservingQueueTransition =
            Boolean(
                queueEstimate &&
                Date.now() <= queueTransitionGraceUntil &&
                queueTransitionHoldSeconds > 0
            );

        const visible =
            settings.activityTrackerEnabled &&
            activityStarted &&
            !activityPanelClosed &&
            (
                activityStillActive ||
                preservingQueueTransition
            ) &&
            !combatHasHeaderPriority;

        setClassEnabled(
            activityHeaderLayout,
            'tf-active',
            visible
        );

        if (!visible) {
            document.getElementById(
                'tf-header-xp-tooltip'
            )?.classList.remove('tf-open');
            document.getElementById(
                'tf-header-queue-tooltip'
            )?.classList.remove('tf-open');
            return;
        }

        const headerXPRates =
            getActivityXPRateSnapshot();

        const xp =
            settings.actualVsTheoreticalXPEnabled
                ? formatRate(
                    headerXPRates.theoretical
                )
                : (
                    activityEstimatedXPPerHour ===
                        null
                        ? '—'
                        : Math.round(
                            activityEstimatedXPPerHour
                        ).toLocaleString()
                );

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
                ? `${formatDuration(queueEstimate.seconds)} · Ends ${formatQueueFinishClock(queueEstimate.seconds)}`
                : '—';

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-xp'
            ),
            xp
        );

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-items'
            ),
            items
        );

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-level-label'
            ),
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
                )
        );

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-level'
            ),
            levelValue
        );

        const queueStat =
            activityHeaderLayout.querySelector(
                '[data-kind="queue"]'
            );

        setDisplayIfChanged(
            queueStat,
            settings.activityQueueRemaining &&
            queueEstimate
                ? 'flex'
                : 'none'
        );

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-queue'
            ),
            queueText
        );

        setTextIfChanged(
            activityHeaderLayout.querySelector(
                '#tf-header-task'
            ),
            `${titleCaseSkill(activitySkill)} • ${activityTaskName}`
        );

        if (
            document.getElementById(
                'tf-header-xp-tooltip'
            )?.classList.contains('tf-open')
        ) {
            renderActivityXPRateTooltip();
        }

        if (
            document.getElementById(
                'tf-header-queue-tooltip'
            )?.classList.contains('tf-open')
        ) {
            renderQueueCompletionTooltip();
        }
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
                const nextValue =
                    !settings[
                        settingKey
                    ];

                updateSetting(
                    settingKey,
                    nextValue
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
            `v${FIRST_MATE_VERSION} · ${FIRST_MATE_BUILD_ID}`;

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

                        const showNetGoldRow =
                            document.createElement(
                                'div'
                            );

                        showNetGoldRow.className =
                            'tf-firstmate-toggle-row';

                        showNetGoldRow.dataset.parentToggle =
                            'combatTrackerEnabled';

                        const showNetGoldLabel =
                            document.createElement(
                                'span'
                            );

                        showNetGoldLabel.className =
                            'tf-firstmate-setting-label';

                        showNetGoldLabel.textContent =
                            'Show Net Gold';

                        showNetGoldRow.append(
                            showNetGoldLabel,
                            createToggle(
                                'combatShowNetGold'
                            )
                        );

                        cardBody.appendChild(
                            showNetGoldRow
                        );

                        const perHourRow =
                            document.createElement(
                                'div'
                            );

                        perHourRow.className =
                            'tf-firstmate-select-row';

                        perHourRow.dataset.parentToggle =
                            'combatTrackerEnabled';

                        const perHourLabel =
                            document.createElement(
                                'span'
                            );

                        perHourLabel.className =
                            'tf-firstmate-setting-label';

                        perHourLabel.textContent =
                            'Per-Hour Stat';

                        perHourRow.append(
                            perHourLabel,
                            createSelect(
                                'combatPerHourMetric',
                                [
                                    {
                                        value:
                                            'net',
                                        label:
                                            'Net Profit / hr'
                                    },
                                    {
                                        value:
                                            'gross',
                                        label:
                                            'Profit / hr'
                                    }
                                ]
                            )
                        );

                        cardBody.appendChild(
                            perHourRow
                        );

                    }
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Combat Damage Tracker',

                description:
                    'Track observed DMG (average volley damage), minimum and maximum hit, total damage, hits, misses, and accuracy from Tidefall combat events.',

                toggleKey:
                    'combatDamageTrackerEnabled'
            })
        );

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Combat Session History',

                description:
                    'Save the last 20 completed PvE sessions with duration, kills, XP, net gold, net gold per hour, and XP per hour. Open History from the PvE tracker or click PvE in header mode.',

                toggleKey:
                    'combatSessionHistoryEnabled',

                extraContent:
                    cardBody => {
                        const row =
                            document.createElement(
                                'div'
                            );

                        row.className =
                            'tf-firstmate-select-row';
                        row.dataset.parentToggle =
                            'combatSessionHistoryEnabled';

                        const button =
                            document.createElement(
                                'button'
                            );

                        button.type = 'button';
                        button.className =
                            'tf-firstmate-refresh-button';
                        button.textContent =
                            'VIEW HISTORY';

                        button.addEventListener(
                            'click',
                            openCombatSessionHistory
                        );

                        row.appendChild(button);
                        cardBody.appendChild(row);
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

        combatGroup.appendChild(
            createSettingsCard({
                title:
                    'Heal Timing Glow',

                description:
                    'Glow the equipped food/repair-kit tile: green when healing now wastes nothing, yellow when it\'s ok but not ideal, red when it\'s critical.',

                toggleKey:
                    'healGlowEnabled',

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
                    'Show estimated remaining time and the projected queue end time in the Activity Session header.',

                toggleKey:
                    'activityQueueRemaining'
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Queue Completion Details',

                description:
                    'Hover Queue in the Activity header to see each active and queued activity with its projected completion time.',

                toggleKey:
                    'queueCompletionDetailsEnabled'
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Actual vs Theoretical XP/hr',

                description:
                    'Compare the recipe and current-modifier XP rate against the XP rate actually observed during this session. Hover XP/H in header mode for the comparison.',

                toggleKey:
                    'actualVsTheoreticalXPEnabled'
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Rolling XP Rates',

                description:
                    'Track observed XP per hour over rolling 5-minute, 15-minute, and 1-hour windows. Hover XP/H in header mode to view them.',

                toggleKey:
                    'rollingXPRatesEnabled'
            })
        );

        activityGroup.appendChild(
            createSettingsCard({
                title:
                    'Queue Finished Notification',

                description:
                    'Show a First Mate in-game warning when the full activity queue finishes. Uses the same warning style as Low Hull and stays visible until clicked.',

                toggleKey:
                    'queueFinishedNotificationEnabled'
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

        const combatDamageTrackerEnabledNow =
            Boolean(settings.combatDamageTrackerEnabled);

        if (
            combatDamageTrackerEnabledNow !==
            combatDamageTrackerLastEnabled
        ) {
            /* Start with a clean baseline whenever the live damage tracker is
             * toggled. This prevents combat-log lines created while disabled
             * from being counted as new damage when it is enabled again. */
            resetCombatDamageSession();
            combatDamageTrackerLastEnabled =
                combatDamageTrackerEnabledNow;
        }

        if (!combatDamageTrackerEnabledNow) {
            closeDamageWindow();
        }

        setDisplayIfChanged(
            combatHistoryButton,
            settings.combatSessionHistoryEnabled
                ? ''
                : 'none'
        );

        if (
            !settings.combatSessionHistoryEnabled
        ) {
            closeCombatSessionHistory();
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
            !settings.queueFinishedNotificationEnabled
        ) {
            clearQueueNotificationState();
            queueFinishedToast.classList.remove(
                'tf-open'
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
        damageWindow,
        damageWindowHeader
    );

    makePanelDraggable(
        combatHistoryWindow,
        combatHistoryHeader
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
            mutations => {
                if (
                    !hasNonFirstMateMutation(
                        mutations
                    )
                ) {
                    return;
                }

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

    let combatObserverTimer =
        null;

    function processDamageEntriesFromMutation(mutation) {
        if (
            !settings.combatTrackerEnabled ||
            !settings.combatDamageTrackerEnabled
        ) {
            return;
        }

        const candidates = new Set();

        const addCandidate = node => {
            if (!(node instanceof Element)) return;

            const damageSelector =
                '.log-entry.log-combat.combat-row--outgoing-hit[data-sent-at], ' +
                '.log-entry.log-combat.combat-row--miss[data-sent-at]';

            if (node.matches?.(damageSelector)) {
                candidates.add(node);
            }

            node.querySelectorAll?.(damageSelector)
                .forEach(entry => candidates.add(entry));

            const parentEntry =
                node.closest?.(damageSelector);
            if (parentEntry) candidates.add(parentEntry);
        };

        if (mutation.type === 'characterData') {
            addCandidate(mutation.target?.parentElement);
        } else {
            addCandidate(mutation.target);
            mutation.addedNodes?.forEach(addCandidate);
        }

        candidates.forEach(processDamageEvent);
    }

    const combatObserver =
        new MutationObserver(
            mutations => {
                if (
                    !hasNonFirstMateMutation(
                        mutations
                    )
                ) {
                    return;
                }

                /* Capture transient outgoing damage immediately. A one-shot
                 * victory can cause Tidefall to replace/remove the combat-log
                 * node before the normal debounced scan runs. */
                mutations.forEach(
                    processDamageEntriesFromMutation
                );

                if (combatObserverTimer !== null) {
                    return;
                }

                combatObserverTimer =
                    window.setTimeout(
                        () => {
                            combatObserverTimer = null;
                            scanVictories();
                        },
                        50
                    );
            }
        );

    combatObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true,
            characterData: true
        }
    );

    let combatItemObserverTimer =
        null;

    const combatItemObserver =
        new MutationObserver(
            mutations => {
                const relevant =
                    mutations.some(
                        mutation => {
                            const target =
                                mutation.target;

                            if (
                                target?.nodeType === 1 &&
                                target.closest?.(
                                    '#combat-ammo-hud-munitions'
                                )
                            ) {
                                return true;
                            }

                            const parent =
                                target?.parentElement;

                            if (
                                parent?.closest?.(
                                    '#combat-ammo-hud-munitions'
                                )
                            ) {
                                return true;
                            }

                            return Array.from(
                                mutation.addedNodes || []
                            ).some(
                                node =>
                                    node?.nodeType === 1 &&
                                    (
                                        node.matches?.(
                                            '#combat-ammo-hud-munitions'
                                        ) ||
                                        node.querySelector?.(
                                            '#combat-ammo-hud-munitions'
                                        )
                                    )
                            );
                        }
                    );

                if (
                    !relevant ||
                    combatItemObserverTimer !== null
                ) {
                    return;
                }

                combatItemObserverTimer =
                    window.setTimeout(
                        () => {
                            combatItemObserverTimer = null;
                            scanItemConsumption();
                        },
                        25
                    );
            }
        );

    combatItemObserver.observe(
        document.body,
        {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                'data-qty',
                'data-quantity',
                'data-item-id',
                'data-item-type',
                'class',
                'hidden'
            ]
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
        scanCannonWear,
        ITEM_SCAN_INTERVAL
    );

    setInterval(
        scanMarketPrices,
        MARKET_SCAN_INTERVAL
    );

    /*
     * One consolidated 1-second UI tick. The old build scheduled
     * updateCombatDisplay(), updateActivityDisplay(),
     * updateActivityHeaderLayout(), and updateCombatHeaderLayout()
     * on overlapping 1-second intervals. Their work landed in the
     * same frame and produced the visible once-per-second hitch.
     */
    setInterval(
        () => {
            updateCombatDisplay();

            if (
                settings.activityTrackerEnabled &&
                activityStarted &&
                settings.activitySessionLayout ===
                    'standard'
            ) {
                updateActivityDisplay();
            }
        },
        DISPLAY_INTERVAL
    );

    setInterval(
        checkCombatWarnings,
        WARNING_SCAN_INTERVAL
    );

    setInterval(
        updateHealGlow,
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
        checkPvEAutoReset,
        500
    );


    const startupDisplayAndCameraInterval =
        setInterval(
            () => {
                if (startupFollowShipApplied) {
                    clearInterval(
                        startupDisplayAndCameraInterval
                    );

                    return;
                }

                void applyStartupDisplayAndCamera();
            },
            500
        );

    setInterval(
        checkNavigationFollowShip,
        250
    );

    window.addEventListener(
        'pagehide',
        () => {
            archiveCombatSession();

            /*
             * The price cache write is debounced by 150ms
             * (schedulePriceCacheSave). Flush it here so a
             * price update just before the tab closes isn't
             * silently lost.
             */
            if (priceCacheSaveTimer !== null) {
                clearTimeout(
                    priceCacheSaveTimer
                );

                priceCacheSaveTimer = null;

                savePriceCache();
            }
        }
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
    combatSessionStartedAt = 0;
    combatHistoryArchivedCurrentSession = false;

    consumedItems.clear();
    sessionPrices.clear();
    lastQuantities.clear();
    lastCannonConditions.clear();
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

    syncQuartermasterPriceCache(true);
    scanMarketPrices();

    updateCombatDisplay();

    updateCombatButton();

    updateActivityDisplay();

    bindSkillProgressBars();

    handleSettingsChanged();

    checkIdleWarning();


    void applyStartupDisplayAndCamera();

    console.log(
        `[Tidefall First Mate] Loaded v${FIRST_MATE_VERSION} (${FIRST_MATE_BUILD_ID})`
    );

})();
